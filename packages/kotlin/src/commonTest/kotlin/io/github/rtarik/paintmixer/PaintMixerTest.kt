package io.github.rtarik.paintmixer

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PaintMixerTest {

    private val mixer = PaintMixers.default()

    @Test
    fun emptyPortionsReturnNull() {
        assertNull(mixer.mixOrNull(emptyList()))
    }

    @Test
    fun singleColorReturnsOriginal() {
        val red = SrgbColor.fromHex("#E53935")

        val result = mixer.mixOrNull(
            listOf(
                MixPortion(color = red, parts = 3),
            )
        )

        assertNotNull(result)
        assertClose(red, result, tolerance = 0.0001f)
    }

    @Test
    fun blueAndYellowProduceGreenishMix() {
        val blue = SrgbColor.fromHex("#002ECE")
        val yellow = SrgbColor.fromHex("#FFF03E")

        val result = mixer.mixOrNull(
            listOf(
                MixPortion(color = blue, parts = 1),
                MixPortion(color = yellow, parts = 1),
            )
        )

        assertNotNull(result)
        assertTrue(
            result.green > result.red,
            "Expected green to dominate red, got ${result.toHexString()}",
        )
        assertTrue(
            result.green > result.blue,
            "Expected green to dominate blue, got ${result.toHexString()}",
        )
    }

    @Test
    fun whiteAndNearBlackStayNeutral() {
        val white = SrgbColor.fromHex("#FFFFFF")
        val nearBlack = SrgbColor.fromHex("#101010")

        val result = mixer.mixOrNull(
            listOf(
                MixPortion(color = white, parts = 1),
                MixPortion(color = nearBlack, parts = 1),
            )
        )

        assertNotNull(result)
        val maxChannel = maxOf(result.red, result.green, result.blue)
        val minChannel = minOf(result.red, result.green, result.blue)
        assertTrue(
            maxChannel - minChannel < 0.06f,
            "Expected a neutral gray, got ${result.toHexString()}",
        )
    }

    @Test
    fun pipelineAppliesResidualCorrectionAfterBaseEngine() {
        val base = object : BaseMixEngine {
            override val engineId: String = "stub-base"

            override fun mixOrNull(portions: List<MixPortion>): SrgbColor? =
                SrgbColor.fromHex("#223344")
        }
        val correction = object : ResidualCorrectionModel {
            override val modelId: String = "stub-correction"
            override val expectedBaseEngineId: String? = "stub-base"

            var observedBaseMix: SrgbColor? = null
            var observedPortionCount: Int = -1

            override fun correct(portions: List<MixPortion>, baseMix: SrgbColor): SrgbColor {
                observedBaseMix = baseMix
                observedPortionCount = portions.size
                return SrgbColor.fromHex("#556677")
            }
        }

        val mixer = PaintMixers.pipeline(baseEngine = base, correctionModel = correction)
        val result = mixer.mixOrNull(
            listOf(
                MixPortion(SrgbColor.fromHex("#AA0000"), 1),
                MixPortion(SrgbColor.fromHex("#0000AA"), 1),
            )
        )

        assertNotNull(result)
        assertClose(SrgbColor.fromHex("#556677"), result, tolerance = 0.0001f)
        assertEquals("#223344", correction.observedBaseMix?.toHexString())
        assertEquals(2, correction.observedPortionCount)
    }

    @Test
    fun pipelineSkipsResidualCorrectionForSinglePortion() {
        val base = object : BaseMixEngine {
            override val engineId: String = "single-base"

            override fun mixOrNull(portions: List<MixPortion>): SrgbColor? =
                SrgbColor.fromHex("#445566")
        }
        val correction = object : ResidualCorrectionModel {
            override val modelId: String = "unused-correction"
            override val expectedBaseEngineId: String? = "single-base"

            var called = false

            override fun correct(portions: List<MixPortion>, baseMix: SrgbColor): SrgbColor {
                called = true
                return SrgbColor.fromHex("#FFFFFF")
            }
        }

        val mixer = PaintMixers.pipeline(baseEngine = base, correctionModel = correction)
        val result = mixer.mixOrNull(
            listOf(
                MixPortion(SrgbColor.fromHex("#123456"), 4),
            )
        )

        assertNotNull(result)
        assertClose(SrgbColor.fromHex("#445566"), result, tolerance = 0.0001f)
        assertTrue(!correction.called, "Expected single-color mixes to bypass residual correction")
    }

    private fun assertClose(expected: SrgbColor, actual: SrgbColor, tolerance: Float) {
        assertTrue(abs(expected.red - actual.red) <= tolerance, "red differs: $expected vs $actual")
        assertTrue(abs(expected.green - actual.green) <= tolerance, "green differs: $expected vs $actual")
        assertTrue(abs(expected.blue - actual.blue) <= tolerance, "blue differs: $expected vs $actual")
    }
}
