# SpectralNN Paint Mixer Kotlin

Kotlin Multiplatform runtime package for the SpectralNN paint mixing engine.

Planned Maven Central coordinate:

```kotlin
implementation("io.github.rtarik:spectralnn-paint-mixer-kotlin:0.1.0-alpha.1")
```

Example:

```kotlin
import io.github.rtarik.paintmixer.MixPortion
import io.github.rtarik.paintmixer.PaintMixers
import io.github.rtarik.paintmixer.SrgbColor

val mixer = PaintMixers.default()
val result = mixer.mixOrNull(
    listOf(
        MixPortion(color = SrgbColor.fromHex("#E53935"), parts = 1),
        MixPortion(color = SrgbColor.fromHex("#283593"), parts = 1),
    ),
)

println(result?.toHexString())
```

The Kotlin package is published manually through Maven Central. The repository Gradle build is configured for a manual first alpha release rather than an automated publish pipeline.
