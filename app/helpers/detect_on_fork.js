// Import required modules 
const { join } = require("path");
const { fork } = require('child_process');
const { isObject, isType, isArray, isNull, isUndefined } = require("./type_checks");

// Create a timer for timing out the child process
let child_timer = null;

module.exports = function (msg, external_fork) {
    return new Promise((resolve, reject) => {
        // Check the image
        if (!isType(msg.image, Buffer)) {
            reject("Image was not a buffer");
            return;
        }

        // Check the model_options
        if (!isObject(msg.model_options)) {
            msg.model_options = {
                "model": "ssd",
                "minConfidence": 0.6,
                "maxResults": 100
            };
        }

        // Check the detect_options
        if (!isObject(msg.detect_options)) {
            msg.detect_options = {
                "landmarks": true,
                "age_gender": true,
                "expressions": true,
                "descriptors": true
            };
        }

        // Check if any descriptors have been added properly
        if (!isArray(msg.descriptors)) {
            msg.descriptors = [];
        }

        // Use external fork or create a new one
        let child_process = null;
        if (isUndefined(external_fork) || isNull(external_fork)) {
            // Create a child process using the script for the node
            const args = [];
            const options = { stdio: "pipe" };
            child_process = fork(join(__dirname, '../nodes/inference_node.js'), args, options);

            // Create a callback to handle a error events
            child_process.on('error', (err, signal) => {
                reject("Child - " + err);
            });

            // Create callback to handle a exit events 
            child_process.on('exit', (code, signal) => {
                reject(`Child - child_process exited with code ${code} and signal ${signal}`);
            });

            child_process.stderr.on('data', (data) => {
                // console.error(data.toString());
            })
        }
        else {
            child_process = external_fork;
        }

        // Set up the message resolver callback
        child_process.on('message', (msg) => {
            if (isUndefined(external_fork) || isNull(external_fork)) {
                child_process.kill('SIGINT');
                child_process = null;
            }
            clearTimeout(child_timer);
            resolve(msg);
        });

        // Send the image and configuration to the child process
        child_process.send(msg);

        // Set a timeout if the inference fails 
        // child_timer = setTimeout(() => { reject("Timed out") }, 30000);
    });
};