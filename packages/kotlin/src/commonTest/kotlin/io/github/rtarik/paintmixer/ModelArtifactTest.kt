package io.github.rtarik.paintmixer

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ModelArtifactTest {

    @Test
    fun bundledArtifactParsesIntoExpectedRuntimeShape() {
        val runtime = DefaultModelArtifact.runtime

        assertEquals("baseline-v1", runtime.modelId)
        assertEquals("spectral_ks_v1", runtime.baseEngineId)
        assertEquals(23, runtime.inputDim)
        assertEquals(listOf(32, 32), runtime.hiddenDims)
        assertEquals(3, runtime.outputDim)
        assertEquals(runtime.inputDim, runtime.featureMean.size)
        assertEquals(runtime.inputDim, runtime.featureStd.size)
        assertEquals(runtime.outputDim, runtime.targetMean.size)
        assertEquals(runtime.outputDim, runtime.targetStd.size)
        assertTrue(runtime.mixingParameters.learnedMixerBlend > 0.0)
    }
}
