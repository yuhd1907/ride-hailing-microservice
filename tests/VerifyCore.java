import java.io.IOException;
import java.io.OutputStream;
import java.net.ProxySelector;
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
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/** Run with Java 17+: java tests/VerifyCore.java */
public class VerifyCore {
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .proxy(ProxySelector.of(null))
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private static final String GATEWAY = env("GATEWAY_URL", "http://127.0.0.1:8080");
    private static final String USER = env("USER_SERVICE_URL", "http://127.0.0.1:8081");
    private static final String DRIVER = env("DRIVER_SERVICE_URL", "http://127.0.0.1:8082");
    private static final List<String> CHECKS = new ArrayList<>();
    private static String token;

    public static void main(String[] args) throws Exception {
        for (String url : List.of(GATEWAY + "/ping", USER + "/ping", DRIVER + "/ping",
                GATEWAY + "/users/ping", GATEWAY + "/drivers/ping")) {
            HttpResponse<String> response = request("GET", url, null);
            require(response.statusCode() == 200 && response.body().equals("UP"), "Expected 200 UP: " + url);
            if (url.startsWith(GATEWAY + "/")) {
                List<String> cidHeaders = response.headers().allValues("X-Correlation-ID");
                require(cidHeaders.size() == 1 && !cidHeaders.get(0).contains(","),
                        "Expected single X-Correlation-ID header from Gateway, got: " + cidHeaders);
            }
            pass("GET " + url + " -> 200 UP (single X-Correlation-ID)");
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

        require(sql("user_postgres", "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'uuid' AND (table_name, column_name) IN (('users', 'id'), ('user_roles', 'user_id'))").equals("2"), "User IDs must use native UUID columns");
        require(sql("driver_postgres", "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'uuid' AND (table_name, column_name) IN (('drivers', 'id'), ('drivers', 'current_trip_id'), ('drivers', 'reservation_id'), ('driver_locations', 'driver_id'))").equals("4"), "Driver IDs must use native UUID columns");
        pass("All domain ID columns use PostgreSQL UUID");

        String suffix = Long.toString(System.currentTimeMillis());
        String id = null;
        String userId = null;
        try {
            String email = "verify." + suffix + "@example.com";
            String userPhone = "09" + suffix.substring(suffix.length() - 8);
            HttpResponse<String> registered = request("POST", GATEWAY + "/auth/register",
                    "{\"email\":\"" + email + "\",\"password\":\"Password@123\",\"fullName\":\"Verification User\",\"phone\":\"" + userPhone + "\",\"role\":\"ROLE_DRIVER\"}");
            require(registered.statusCode() == 201, "Fixture registration failed: " + registered.statusCode());
            userId = UUID.fromString(jsonString(registered.body(), "id")).toString();
            id = userId;
            HttpResponse<String> login = request("POST", GATEWAY + "/auth/login",
                    "{\"email\":\"" + email + "\",\"password\":\"Password@123\"}");
            require(login.statusCode() == 200, "Fixture login failed");
            require(userId.equals(UUID.fromString(jsonString(login.body(), "userId")).toString()), "Login must return the registered UUID");
            token = jsonString(login.body(), "token");
            pass("Registration and login issue a usable JWT");

            HttpResponse<String> createdDriver = request("POST", GATEWAY + "/drivers",
                    "{\"licensePlate\":\"TEST-" + suffix + "\",\"vehicleType\":\"MOTORCYCLE\"}");
            require(createdDriver.statusCode() == 201, "Driver profile creation failed: " + createdDriver.statusCode());
            require(userId.equals(jsonString(createdDriver.body(), "id")), "Driver profile must share account UUID");
            HttpResponse<String> myDriver = request("GET", GATEWAY + "/drivers/me", null);
            require(myDriver.statusCode() == 200 && userId.equals(jsonString(myDriver.body(), "id")), "GET /drivers/me must return own driver profile");
            require(request("POST", GATEWAY + "/drivers/" + id + "/go-online", "").statusCode() == 200, "Driver go-online failed");
            pass("Logged-in driver creates and views own profile with shared account UUID");
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

            require(request("GET", DRIVER + "/drivers/not-a-uuid", null).statusCode() == 400, "Malformed driver UUID must return 400");
            require(request("GET", USER + "/users/not-a-uuid", null).statusCode() == 400, "Malformed user UUID must return 400");
            String tripId = UUID.randomUUID().toString();
            String reservationId = UUID.randomUUID().toString();
            HttpResponse<String> reserved = request("POST", DRIVER + "/internal/drivers/" + id + "/reserve",
                    "{\"tripId\":\"" + tripId + "\",\"reservationId\":\"" + reservationId + "\"}");
            require(reserved.statusCode() == 200, "Reservation with UUID fields failed");
            require(tripId.equals(jsonString(reserved.body(), "currentTripId")) && reservationId.equals(jsonString(reserved.body(), "reservationId")), "Reservation response lost its UUIDs");
            require(request("POST", DRIVER + "/internal/drivers/" + id + "/reserve",
                    "{\"tripId\":\"" + tripId + "\",\"reservationId\":\"" + reservationId + "\"}").statusCode() == 200, "Repeated identical reserve must be idempotent");
            require(request("POST", DRIVER + "/internal/drivers/" + id + "/reserve",
                    "{\"tripId\":\"" + UUID.randomUUID() + "\",\"reservationId\":\"" + UUID.randomUUID() + "\"}").statusCode() == 409, "Concurrent different trip reserve must return 409");
            require(sql("driver_postgres", "SELECT current_trip_id::text || '|' || reservation_id::text FROM drivers WHERE id = '" + id + "'").equals(tripId + "|" + reservationId), "Native UUID reservation fields were not persisted");
            require(request("POST", GATEWAY + "/drivers/" + id + "/go-offline", "").statusCode() == 400, "Reserved driver must not be allowed to go offline");
            require(request("POST", DRIVER + "/internal/drivers/" + id + "/release", "").statusCode() == 200, "Reservation release failed");
            require(request("POST", DRIVER + "/internal/drivers/" + id + "/release", "").statusCode() == 200, "Repeated release must be idempotent");
            pass("UUID validation, idempotent retries and reservation round-trip preserve all domain IDs");

            String missing = UUID.randomUUID().toString();
            require(request("POST", GATEWAY + "/drivers/" + missing + "/location", "{\"latitude\":21,\"longitude\":105}").statusCode() == 403, "Another driver profile must be forbidden (403)");
            HttpRequest uncreatedDriverReq = HttpRequest.newBuilder(URI.create(DRIVER + "/drivers/" + missing + "/location"))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .header("X-User-Id", missing)
                    .header("X-User-Roles", "ROLE_DRIVER")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"latitude\":21,\"longitude\":105}"))
                    .build();
            require(HTTP.send(uncreatedDriverReq, HttpResponse.BodyHandlers.ofString()).statusCode() == 404, "Unknown driver must return 404");
            require(sql("driver_postgres", "SELECT count(*) FROM driver_locations WHERE driver_id = '" + missing + "'").equals("0"), "Unknown driver gained a location");
            pass("Cross-driver mutation returns 403 and unknown driver returns 404 without inserting a location");
            require(request("POST", GATEWAY + "/auth/logout", "").statusCode() == 200, "Logout failed");
            require(request("GET", GATEWAY + "/users/me", null).statusCode() == 401, "Revoked JWT still reaches the service");
            pass("Logout revokes the JWT at Gateway");
        } finally {
            try {
                if (id != null) {
                    sql("driver_postgres", "DELETE FROM drivers WHERE id = '" + id + "'");
                    redis("ZREM", "driver:locations", id);
                }
                if (token != null) redis("DEL", "blacklist:" + token);
            } finally {
                if (userId != null) {
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
        String db = service.equals("user_postgres") ? env("USER_DB_NAME", "user_db") : env("DRIVER_DB_NAME", "driver_db");
        String user = service.equals("user_postgres") ? env("USER_DB_USER", "postgres") : env("DRIVER_DB_USER", "postgres");
        return dockerWithInput(statement + "\n", "exec", "-T", service, "psql", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At", "-f", "-");
    }

    private static String redis(String... arguments) throws Exception {
        List<String> command = new ArrayList<>(List.of("exec", "-T", "redis", "redis-cli", "--raw"));
        command.addAll(List.of(arguments));
        return dockerWithInput(null, command.toArray(String[]::new));
    }

    private static String dockerWithInput(String stdin, String... arguments) throws Exception {
        String executable = resolveDockerExecutable();
        String composeFile = Files.isRegularFile(Path.of("deploy/docker-compose.yml"))
                ? "deploy/docker-compose.yml" : "docker-compose.yml";
        List<String> command = new ArrayList<>(List.of(executable, "compose", "-p",
                env("COMPOSE_PROJECT_NAME", "ride-hailing-microservice"), "-f", composeFile));
        if (Files.isRegularFile(Path.of(".env"))) command.addAll(List.of("--env-file", ".env"));
        String override = System.getenv("COMPOSE_OVERRIDE_FILE");
        if (override != null && !override.isBlank()) command.addAll(List.of("-f", override));
        command.addAll(List.of(arguments));
        Path outputFile = Files.createTempFile("ride-hailing-check-", ".log");
        try {
            Process process = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(outputFile.toFile()).start();
            try (OutputStream out = process.getOutputStream()) {
                if (stdin != null) {
                    out.write(stdin.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
            }
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

    private static String resolveDockerExecutable() {
        String executable = env("DOCKER_CLI", "docker");
        if (!executable.equals("docker")) return executable;
        List<Path> candidates = new ArrayList<>();
        String programFiles = System.getenv("ProgramFiles");
        if (programFiles != null) {
            candidates.add(Path.of(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe"));
        }
        String programW6432 = System.getenv("ProgramW6432");
        if (programW6432 != null) {
            candidates.add(Path.of(programW6432, "Docker", "Docker", "resources", "bin", "docker.exe"));
        }
        String localAppData = System.getenv("LOCALAPPDATA");
        if (localAppData != null) {
            candidates.add(Path.of(localAppData, "Programs", "DockerDesktop", "resources", "bin", "docker.exe"));
        }
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) return candidate.toString();
        }
        return executable;
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
