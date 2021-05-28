// Import helpers
const { isString } = require("./type_checks");

// Export main function
module.exports = function (options) {
    // Parse input string as JSON if supplied
    if (isString(options)) {
        options = JSON.parse(options);
    }

    // Create a default options template
    let detect_options = {}

    // Check for landmarks
    if ('landmarks' in options) detect_options['landmarks'] = true;

    // Check for age and gender
    if ('age_gender' in options) detect_options['age_gender'] = true;

    // Check for expressions
    if ('expressions' in options) detect_options['expressions'] = true;

    // Check for descriptors
    if ('descriptors' in options) detect_options['descriptors'] = true;

    // Return options
    return detect_options;
}