import com.vanniktech.maven.publish.JavadocJar
import com.vanniktech.maven.publish.KotlinMultiplatform
import org.gradle.api.tasks.testing.Test
import org.gradle.plugins.signing.SigningExtension

plugins {
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.vanniktechMavenPublish)
    id("maven-publish")
}

kotlin {
    androidTarget {
        publishLibraryVariants("release")
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

mavenPublishing {
    configure(
        KotlinMultiplatform(
            javadocJar = JavadocJar.Empty(),
        ),
    )
    publishToMavenCentral()
    signAllPublications()
    pom {
        name.set("SpectralNN Paint Mixer Kotlin")
        description.set("Kotlin runtime package for the SpectralNN paint mixing engine.")
        inceptionYear.set("2026")
        url.set("https://github.com/rtarik/spectralnn-paint-mixer")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/license/mit")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("rtarik")
                name.set("Tarik Rahmatallah")
                url.set("https://github.com/rtarik/")
            }
        }
        scm {
            url.set("https://github.com/rtarik/spectralnn-paint-mixer")
            connection.set("scm:git:git://github.com/rtarik/spectralnn-paint-mixer.git")
            developerConnection.set("scm:git:ssh://git@github.com/rtarik/spectralnn-paint-mixer.git")
        }
    }
}

extensions.configure(SigningExtension::class.java) {
    useGpgCmd()
}

publishing {
    repositories {
        maven {
            name = "localValidation"
            url = uri(rootProject.layout.projectDirectory.dir("out/m2-local"))
        }
    }
}

tasks.withType<Test>().configureEach {
    systemProperty(
        "paintmixer.fixtureFile",
        layout.projectDirectory.file("../../artifacts/fixtures/baseline-v1/curated-parity.json").asFile.absolutePath,
    )
}
