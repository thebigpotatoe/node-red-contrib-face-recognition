// Export the main function
module.exports = async function () {
    return new Promise((resolve, reject) => {
        // Try load in Tfjs-node if it is installed
        try {
            require('@tensorflow/tfjs-node');
            resolve();
        }
        catch (err) {
            if (err instanceof Error && err.code === "MODULE_NOT_FOUND")
                reject("[Face-api.js] - TensorFlow.js for Node.js was not found, running without it");
            else
                reject(err);
        }
    })
}