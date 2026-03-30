package io.github.rtarik.paintmixer

@ConsistentCopyVisibility
data class SrgbColor private constructor(
    val red: Float,
    val green: Float,
    val blue: Float,
) {
    companion object {
        fun fromUnitRgb(red: Float, green: Float, blue: Float): SrgbColor {
            requireUnitChannel("red", red)
            requireUnitChannel("green", green)
            requireUnitChannel("blue", blue)
            return SrgbColor(red = red, green = green, blue = blue)
        }

        fun fromRgb8(red: Int, green: Int, blue: Int): SrgbColor {
            requireByteChannel("red", red)
            requireByteChannel("green", green)
            requireByteChannel("blue", blue)
            return fromUnitRgb(
                red = red / 255f,
                green = green / 255f,
                blue = blue / 255f,
            )
        }

        fun fromHex(hex: String): SrgbColor {
            val raw = hex.removePrefix("#")
            val rgb = when (raw.length) {
                6 -> raw
                8 -> {
                    require(raw.startsWith("FF", ignoreCase = true)) {
                        "Opaque-only colors require alpha FF in 8-digit hex, got $hex"
                    }
                    raw.substring(2)
                }

                else -> error("Expected #RRGGBB or #FFRRGGBB, got $hex")
            }
            return fromRgb8(
                red = rgb.substring(0, 2).toInt(16),
                green = rgb.substring(2, 4).toInt(16),
                blue = rgb.substring(4, 6).toInt(16),
            )
        }

        private fun requireUnitChannel(name: String, value: Float) {
            require(value in 0f..1f) { "$name must be in 0..1, got $value" }
        }

        private fun requireByteChannel(name: String, value: Int) {
            require(value in 0..255) { "$name must be in 0..255, got $value" }
        }
    }

    fun toHexString(): String = buildString {
        append('#')
        append(red.toHexPair())
        append(green.toHexPair())
        append(blue.toHexPair())
    }
}

private fun Float.toHexPair(): String =
    (this * 255f)
        .toInt()
        .coerceIn(0, 255)
        .toString(16)
        .uppercase()
        .padStart(2, '0')
