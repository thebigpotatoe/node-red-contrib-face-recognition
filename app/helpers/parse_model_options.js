// Load in face-api.js
const faceapi = require('face-api.js');

// Import helpers
const { isString } = require("./type_checks");

// Export main function
module.exports = function (options) {
    // Parse input string as JSON if supplied
    if (isString(options)) {
        options = JSON.parse(options);
    }

    // Check if model is valid
    if ('model' in options && (typeof options.model === 'string' || options.model instanceof String)) {
        // Setup the model depending on which one is chosen
        let model_options = {}
        if (options.model.toLowerCase() === 'ssd') {
            let model_min_confidence = parseFloat(options.minConfidence);
            let model_max_results = parseInt(options.maxResults);
            if (typeof model_min_confidence === 'number' && isFinite(model_min_confidence)) model_options['minConfidence'] = model_min_confidence;
            if (typeof model_max_results === 'number' && isFinite(model_max_results)) model_options['maxResults'] = model_max_results;
            return new faceapi.SsdMobilenetv1Options(model_options);
        }
        else if (options.model.toLowerCase() === 'tiny') {
            let model_score_threshold = parseFloat(options.scoreThreshold);
            let model_input_size = parseInt(options.inputSize);
            if (typeof model_score_threshold === 'number' && isFinite(model_score_threshold)) model_options['scoreThreshold'] = model_score_threshold;
            if (typeof model_input_size === 'number' && isFinite(model_input_size)) model_options['inputSize'] = model_input_size;
            return new faceapi.TinyFaceDetectorOptions(model_options);
        }
    }

    // Return nothing if failed
    return;
}