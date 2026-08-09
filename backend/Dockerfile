FROM maven:3.9.11-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn clean package -DskipTests -B

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
RUN addgroup -S spotibase && adduser -S spotibase -G spotibase
COPY --from=build /app/target/*.jar app.jar
RUN chown -R spotibase:spotibase /app
USER spotibase
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
