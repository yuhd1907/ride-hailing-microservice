import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/** Run with Java 17+: java scripts/VerifyCore.java */
public class VerifyCore {
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
    private static final String GATEWAY = env("GATEWAY_URL", "http://localhost:8080");
    private static final String USER = env("USER_SERVICE_URL", "http://localhost:8081");
    private static final String DRIVER = env("DRIVER_SERVICE_URL", "http://localhost:8082");
    private static final List<String> CHECKS = new ArrayList<>();
    private static String token;

    public static void main(String[] args) throws Exception {
        for (String url : List.of(GATEWAY + "/ping", USER + "/ping", DRIVER + "/ping",
                GATEWAY + "/users/ping", GATEWAY + "/drivers/ping")) {
            HttpResponse<String> response = request("GET", url, null);
            require(response.statusCode() == 200 && response.body().equals("UP"), "Expected 200 UP: " + url);
            pass("GET " + url + " -> 200 UP");
        }
        for (String base : List.of(USER, DRIVER)) {
            HttpResponse<String> response = request("GET", base + "/actuator/health", null);
            require(response.statusCode() == 200, "Health check failed: " + base);
            require(componentUp(response.body(), "db"), "Database health is not UP: " + base);
            require(componentUp(response.body(), "redis"), "Redis health is not UP: " + base);
            if (base.equals(DRIVER)) require(componentUp(response.body(), "rabbit"), "RabbitMQ health is not UP");
            pass("Database/cache/broker health: " + base);
        }
        HttpResponse<String> routes = request("GET", GATEWAY + "/actuator/gateway/routes", null);
        require(routes.statusCode() == 200, "Cannot inspect Gateway routes");
        String routeText = routes.body().replaceAll("\\s", "").toUpperCase(Locale.ROOT);
        for (String service : List.of("USER", "DRIVER", "TRIP", "MATCHING", "PAYMENT", "NOTIFICATION")) {
            require(routeText.contains("\"URI\":\"LB://" + service + "-SERVICE\""), "Missing route: " + service);
        }
        pass("Gateway routes cover all six business services");

        require(sql("user_postgres", "SELECT current_database() || '|' || to_regclass('public.users')::text").equals("user_db|users"), "users table missing");
        require(sql("user_postgres", "SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND success").equals("1"), "User migration missing");
        pass("User migration created users in user_db");
        require(sql("driver_postgres", "SELECT current_database() || '|' || to_regclass('public.drivers')::text || '|' || to_regclass('public.driver_locations')::text").equals("driver_db|drivers|driver_locations"), "Driver tables missing");
        require(sql("driver_postgres", "SELECT count(*) FROM flyway_schema_history WHERE version IN ('1','2') AND success").equals("2"), "Driver migrations missing");
        pass("Driver migrations created drivers and driver_locations in driver_db");

        String suffix = Long.toString(System.currentTimeMillis());
        String id = "drv_verify_" + suffix;
        String phone = "09" + suffix.substring(suffix.length() - 8);
        String userId = null;
        try {
            String email = "verify." + suffix + "@example.com";
            String userPhone = "09" + suffix.substring(suffix.length() - 8);
            HttpResponse<String> registered = request("POST", GATEWAY + "/auth/register",
                    "{\"email\":\"" + email + "\",\"password\":\"Password@123\",\"fullName\":\"Verification User\",\"phone\":\"" + userPhone + "\",\"role\":\"ROLE_DRIVER\"}");
            require(registered.statusCode() == 201, "Fixture registration failed: " + registered.statusCode());
            userId = jsonString(registered.body(), "id");
            HttpResponse<String> login = request("POST", GATEWAY + "/auth/login",
                    "{\"email\":\"" + email + "\",\"password\":\"Password@123\"}");
            require(login.statusCode() == 200, "Fixture login failed");
            token = jsonString(login.body(), "token");
            pass("Registration and login issue a usable JWT");
            sql("driver_postgres", "INSERT INTO drivers (id, full_name, phone, license_plate, vehicle_type, status) VALUES ('" + id + "', 'Verification fixture', '" + phone + "', 'TEST-" + suffix + "', 'MOTORCYCLE', 'AVAILABLE')");
            String locationUrl = GATEWAY + "/drivers/" + id + "/location";
            require(request("POST", locationUrl, "{\"latitude\":21.0285,\"longitude\":105.8542}").statusCode() == 200, "Initial location update failed");
            require(request("POST", locationUrl, "{\"latitude\":21.029,\"longitude\":105.855}").statusCode() == 200, "Second location update failed");
            require(sql("driver_postgres", "SELECT count(*) FROM driver_locations WHERE driver_id = '" + id + "' AND latitude = 21.029 AND longitude = 105.855").equals("1"), "Latest PostgreSQL location is incorrect");
            String[] coordinates = redis("GEOPOS", "driver:locations", id).split("\\R");
            require(coordinates.length == 2 && Math.abs(Double.parseDouble(coordinates[0]) - 105.855) < 0.00001
                    && Math.abs(Double.parseDouble(coordinates[1]) - 21.029) < 0.00001, "Redis location is incorrect");
            pass("Two location updates persist one latest row and update Redis GEO");

            require(request("POST", locationUrl, "{\"latitude\":91,\"longitude\":105.855}").statusCode() == 400, "Invalid latitude must return 400");
            require(sql("driver_postgres", "SELECT latitude FROM driver_locations WHERE driver_id = '" + id + "'").equals("21.029"), "Invalid request changed the location");
            pass("Invalid coordinates return 400 without changing stored location");

            String missing = "missing_" + suffix;
            require(request("POST", DRIVER + "/drivers/" + missing + "/location", "{\"latitude\":21,\"longitude\":105}").statusCode() == 404, "Unknown driver must return 404");
            require(sql("driver_postgres", "SELECT count(*) FROM driver_locations WHERE driver_id = '" + missing + "'").equals("0"), "Unknown driver gained a location");
            pass("Unknown driver returns 404 without inserting a location");
            require(request("POST", GATEWAY + "/auth/logout", "").statusCode() == 200, "Logout failed");
            require(request("GET", GATEWAY + "/users/me", null).statusCode() == 401, "Revoked JWT still reaches the service");
            pass("Logout revokes the JWT at Gateway");
        } finally {
            try {
                sql("driver_postgres", "DELETE FROM drivers WHERE id = '" + id + "'");
                redis("ZREM", "driver:locations", id);
                if (token != null) redis("DEL", "blacklist:" + token);
            } finally {
                if (userId != null && userId.matches("usr_[a-f0-9]{32}")) {
                    sql("user_postgres", "DELETE FROM users WHERE id = '" + userId + "'");
                }
            }
        }
        Files.createDirectories(Path.of(".verification"));
        Files.write(Path.of(".verification/core-result.txt"), CHECKS, StandardCharsets.UTF_8);
        System.out.println(CHECKS.size() + " integration checks passed.");
    }

    private static HttpResponse<String> request(String method, String url, String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (body == null) builder.GET();
        else builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body));
        return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static boolean componentUp(String body, String component) {
        return java.util.regex.Pattern.compile("\"" + component + "\"\\s*:\\s*\\{\\s*\"status\"\\s*:\\s*\"UP\"").matcher(body).find();
    }

    private static String sql(String service, String statement) throws Exception {
        return docker("exec", "-T", service, "sh", "-c",
                "exec psql -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -At -c \"$1\"", "sh", statement);
    }

    private static String redis(String... arguments) throws Exception {
        List<String> command = new ArrayList<>(List.of("exec", "-T", "redis", "redis-cli", "--raw"));
        command.addAll(List.of(arguments));
        return docker(command.toArray(String[]::new));
    }

    private static String docker(String... arguments) throws Exception {
        String executable = env("DOCKER_CLI", "docker");
        String localAppData = System.getenv("LOCALAPPDATA");
        if (executable.equals("docker") && localAppData != null) {
            Path candidate = Path.of(localAppData, "Programs", "DockerDesktop", "resources", "bin", "docker.exe");
            if (Files.isRegularFile(candidate)) executable = candidate.toString();
        }
        List<String> command = new ArrayList<>(List.of(executable, "compose", "-p",
                env("COMPOSE_PROJECT_NAME", "ride-hailing-microservice"), "-f", "docker-compose.yml"));
        String override = System.getenv("COMPOSE_OVERRIDE_FILE");
        if (override != null && !override.isBlank()) command.addAll(List.of("-f", override));
        command.addAll(List.of(arguments));
        Path outputFile = Files.createTempFile("ride-hailing-check-", ".log");
        try {
            Process process = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(outputFile.toFile()).start();
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
                throw new IOException("Docker did not respond within 30 seconds");
            }
            String output = Files.readString(outputFile, StandardCharsets.UTF_8).trim();
            if (process.exitValue() != 0) throw new IOException("Docker command failed: " + output);
            return output;
        } finally {
            Files.deleteIfExists(outputFile);
        }
    }

    private static String jsonString(String body, String field) {
        var match = Pattern.compile("\"" + Pattern.quote(field) + "\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
        if (!match.find()) throw new IllegalStateException("Response has no " + field);
        return match.group(1);
    }

    private static String env(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    private static void pass(String message) {
        CHECKS.add(message);
        System.out.println("PASS " + message);
    }
}
