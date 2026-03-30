package io.github.rtarik.paintmixer

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

class BaselineFixtureParityTest {

    private val mixer = PaintMixers.default()
    private val fixtures = loadFixtureSet()

    @Test
    fun fixtureSetTargetsTheBundledBaselineArtifact() {
        assertEquals(1, fixtures.fixtureSetVersion)
        assertEquals(DefaultModelArtifact.runtime.modelId, fixtures.modelId)
        assertTrue(fixtures.cases.isNotEmpty(), "Expected at least one baseline fixture")
    }

    @Test
    fun curatedBaselineFixturesStayWithinTheirFrozenEnvelope() {
        val failures = mutableListOf<String>()

        fixtures.cases.forEach { fixture ->
            val result = mixer.mixOrNull(
                fixture.inputs.zip(fixture.parts).map { (hex, parts) ->
                    MixPortion(
                        color = SrgbColor.fromHex(hex),
                        parts = parts,
                    )
                }
            )

            assertNotNull(result, "Expected a mix result for fixture ${fixture.id}")
            failures += rgb8DriftMessages(
                expectedHex = fixture.baselineHex,
                actual = result,
                maxChannelStep = 1,
                fixtureId = fixture.id,
            )

            val deltaE = deltaE76(result, SrgbColor.fromHex(fixture.targetHex))
            if (deltaE > fixture.maxDeltaE) {
                failures += buildString {
                    append("Fixture ")
                    append(fixture.id)
                    append(" exceeded max ΔE ")
                    append(fixture.maxDeltaE)
                    append(": actual=")
                    append(result.toHexString())
                    append(", baseline=")
                    append(fixture.baselineHex)
                    append(", target=")
                    append(fixture.targetHex)
                    append(", deltaE=")
                    append("%.4f".format(deltaE))
                }
            }
        }

        if (failures.isNotEmpty()) {
            fail(failures.joinToString(separator = "\n"))
        }
    }

    private fun rgb8DriftMessages(
        expectedHex: String,
        actual: SrgbColor,
        maxChannelStep: Int,
        fixtureId: String,
    ): List<String> {
        val expected = Rgb8.fromHex(expectedHex)
        val actualRgb8 = Rgb8.fromHex(actual.toHexString())
        val failures = mutableListOf<String>()
        if (abs(expected.red - actualRgb8.red) > maxChannelStep) {
            failures += "Fixture $fixtureId red channel drifted: expected $expectedHex, got ${actual.toHexString()}"
        }
        if (abs(expected.green - actualRgb8.green) > maxChannelStep) {
            failures += "Fixture $fixtureId green channel drifted: expected $expectedHex, got ${actual.toHexString()}"
        }
        if (abs(expected.blue - actualRgb8.blue) > maxChannelStep) {
            failures += "Fixture $fixtureId blue channel drifted: expected $expectedHex, got ${actual.toHexString()}"
        }
        return failures
    }

    private fun deltaE76(first: SrgbColor, second: SrgbColor): Double {
        val firstLab = srgbToLab(first)
        val secondLab = srgbToLab(second)
        val dl = firstLab.l - secondLab.l
        val da = firstLab.a - secondLab.a
        val db = firstLab.b - secondLab.b
        return sqrt(dl * dl + da * da + db * db)
    }

    private fun srgbToLab(color: SrgbColor): Lab {
        val r = srgbToLinear(color.red.toDouble())
        val g = srgbToLinear(color.green.toDouble())
        val b = srgbToLinear(color.blue.toDouble())

        val x = 0.4123907992659593 * r + 0.3575843393838777 * g + 0.1804807884018343 * b
        val y = 0.21263900587151033 * r + 0.7151686787677553 * g + 0.07219231536073373 * b
        val z = 0.019330818715591832 * r + 0.11919477979462595 * g + 0.9505321522496605 * b

        fun labF(value: Double): Double =
            if (value > 0.008856) value.pow(1.0 / 3.0)
            else 7.787 * value + 16.0 / 116.0

        val fx = labF(x / 0.95047)
        val fy = labF(y / 1.0)
        val fz = labF(z / 1.08883)

        return Lab(
            l = 116.0 * fy - 16.0,
            a = 500.0 * (fx - fy),
            b = 200.0 * (fy - fz),
        )
    }

    private fun srgbToLinear(channel: Double): Double =
        if (channel <= 0.04045) channel / 12.92
        else ((channel + 0.055) / 1.055).pow(2.4)

    private fun loadFixtureSet(): BaselineFixtureSet {
        val path = checkNotNull(System.getProperty("paintmixer.fixtureFile")) {
            "Expected paintmixer.fixtureFile system property"
        }
        return Json.decodeFromString(File(path).readText())
    }
}

@Serializable
private data class BaselineFixtureSet(
    val fixtureSetVersion: Int,
    val modelId: String,
    val createdAt: String,
    val referenceReport: String,
    val cases: List<BaselineFixtureCase>,
)

@Serializable
private data class BaselineFixtureCase(
    val id: String,
    val category: String,
    val palette: String,
    val label: String,
    val inputs: List<String>,
    val parts: List<Int>,
    val baselineHex: String,
    val targetHex: String,
    val referenceDeltaE: Double,
    val maxDeltaE: Double,
)

private data class Lab(
    val l: Double,
    val a: Double,
    val b: Double,
)

private data class Rgb8(
    val red: Int,
    val green: Int,
    val blue: Int,
) {
    companion object {
        fun fromHex(hex: String): Rgb8 {
            val raw = hex.removePrefix("#")
            require(raw.length == 6) { "Expected #RRGGBB, got $hex" }
            return Rgb8(
                red = raw.substring(0, 2).toInt(16),
                green = raw.substring(2, 4).toInt(16),
                blue = raw.substring(4, 6).toInt(16),
            )
        }
    }
}
