plugins {
    alias(libs.plugins.androidLibrary) apply false
    alias(libs.plugins.kotlinMultiplatform) apply false
    alias(libs.plugins.kotlinSerialization) apply false
}

group = providers.gradleProperty("GROUP").orElse("io.github.rtarik").get()
version = providers.gradleProperty("VERSION_NAME").orElse("0.1.0-local").get()

subprojects {
    group = rootProject.group
    version = rootProject.version
}

tasks.register("publishKotlinToLocalRepo") {
    group = "publishing"
    description = "Publishes the Kotlin package to the staged local Maven repository."
    dependsOn(":spectralnn-paint-mixer-kotlin:publishAllPublicationsToLocalValidationRepository")
}
