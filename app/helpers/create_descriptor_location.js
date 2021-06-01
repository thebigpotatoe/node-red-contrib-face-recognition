// Import Canvas and face-api.js
const { stat, mkdir } = require('fs').promises

// Export main function
module.exports = function (location) {
    return new Promise(async function (resolve, reject) {
        stat(location)
            .then(resolve, mkdir.bind(null, location))
            .catch(reject);
    });
}