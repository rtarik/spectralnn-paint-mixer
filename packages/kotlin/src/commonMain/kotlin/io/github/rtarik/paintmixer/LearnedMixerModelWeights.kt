package io.github.rtarik.paintmixer

internal object LearnedMixerModelWeights {

    private val runtime: RuntimeModelArtifact
        get() = DefaultModelArtifact.runtime

    val enabled: Boolean
        get() = true

    val inputDim: Int
        get() = runtime.inputDim

    val hidden1Dim: Int
        get() = runtime.hiddenDims[0]

    val hidden2Dim: Int
        get() = runtime.hiddenDims[1]

    val featureMean: DoubleArray
        get() = runtime.featureMean

    val featureStd: DoubleArray
        get() = runtime.featureStd

    val targetMean: DoubleArray
        get() = runtime.targetMean

    val targetStd: DoubleArray
        get() = runtime.targetStd

    val layer1Weights: Array<DoubleArray>
        get() = runtime.w1

    val layer1Bias: DoubleArray
        get() = runtime.b1

    val layer2Weights: Array<DoubleArray>
        get() = runtime.w2

    val layer2Bias: DoubleArray
        get() = runtime.b2

    val outputWeights: Array<DoubleArray>
        get() = runtime.w3

    val outputBias: DoubleArray
        get() = runtime.b3
}

