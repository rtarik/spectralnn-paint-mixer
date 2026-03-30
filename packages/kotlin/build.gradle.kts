import org.gradle.api.tasks.testing.Test
import org.gradle.api.publish.maven.MavenPublication

plugins {
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
    id("maven-publish")
}

kotlin {
    androidTarget {
        publishLibraryVariants("release", "debug")
    }
    jvm()
    iosX64()
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
    }
}

android {
    namespace = "io.github.rtarik.paintmixer"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
    }
}

publishing {
    repositories {
        maven {
            name = "localValidation"
            url = uri(rootProject.layout.projectDirectory.dir("out/m2-local"))
        }
    }
    publications.withType(MavenPublication::class.java).configureEach {
        pom {
            name.set("SpectralNN Paint Mixer Kotlin")
            description.set("Kotlin runtime package for the SpectralNN paint mixing engine.")
            licenses {
                license {
                    name.set("MIT License")
                    url.set("https://opensource.org/license/mit")
                }
            }
        }
    }
}

tasks.withType<Test>().configureEach {
    systemProperty(
        "paintmixer.fixtureFile",
        layout.projectDirectory.file("../../artifacts/fixtures/baseline-v1/curated-parity.json").asFile.absolutePath,
    )
}
