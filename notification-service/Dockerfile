# Stage 1: Build
FROM eclipse-temurin:17-jdk AS build
WORKDIR /workspace

# Resolve dependencies in their own layer so source changes don't re-download them
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN chmod +x gradlew && ./gradlew --no-daemon dependencies > /dev/null

COPY src src
RUN ./gradlew --no-daemon bootJar -x test

# Stage 2: Run (alpine image has wget for the compose healthcheck)
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app && mkdir -p /app/logs && chown app:app /app/logs
COPY --from=build /workspace/build/libs/*.jar app.jar
USER app
EXPOSE 8086
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
