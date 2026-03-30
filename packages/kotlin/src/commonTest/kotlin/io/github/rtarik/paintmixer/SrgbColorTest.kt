package io.github.rtarik.paintmixer

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SrgbColorTest {

    @Test
    fun hexRoundTrips() {
        val color = SrgbColor.fromHex("#1B3481")
        assertEquals("#1B3481", color.toHexString())
    }

    @Test
    fun rgb8FactoryProducesExpectedHex() {
        val color = SrgbColor.fromRgb8(255, 255, 255)
        assertEquals("#FFFFFF", color.toHexString())
    }

    @Test
    fun mixPortionRejectsZeroParts() {
        assertFailsWith<IllegalArgumentException> {
            MixPortion(
                color = SrgbColor.fromHex("#FFFFFF"),
                parts = 0,
            )
        }
    }
}

