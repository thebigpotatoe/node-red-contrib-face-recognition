// Load required modules
const { readFile, writeFile, stat } = require("fs").promises;
const { join } = require("path");
const faceapi = require('face-api.js');
const formidable = require('formidable');
const detect_on_fork = require("../helpers/detect_on_fork");

// Create supporting functions
function parse_input_form(req) {
    return new Promise(function (resolve, reject) {
        // Use formidable to parse the files in the request
        var form = new formidable.IncomingForm();
        form.parse(req, function (err, fields, files) {
            (form.openedFiles.length > 0) ? resolve(files) : reject(err || "No files sent with request");
        });
    });
}
function get_file_data(files) {
    return Promise.all(Object.keys(files).map((number) => {
        // Get each of the files data from the POST and put into an array 
        return new Promise((resolve, reject) => {
            stat(files[number].path)
                .then(readFile.bind(this, files[number].path))
                .then(resolve)
                .catch(reject);
        });
    }));
}
function get_descriptors(name, data) {
    return new Promise(async function (resolve, reject) {
        // Create a new array to store each of the calculated descriptors from the files
        let descriptors = [];

        // Inference each file to get the descriptor
        for (i = 0; i < data.length; i++) {
            // Get the inference data from a child fork
            let results = await detect_on_fork({
                "image": data[i],
                "model_options": {
                    "model": "ssd",
                    "minConfidence": 0.6,
                    "maxResults": 1
                },
                "detect_options": {
                    "landmarks": false,
                    "age_gender": false,
                    "expressions": false,
                    "descriptors": true
                }
            });

            // Check if there was a detected face
            if (results.detected_faces.length) {
                // Convert the descriptor data back to float32 after child inference
                let descriptor_array = new Float32Array(128);
                for (const [key, value] of Object.entries(results.detected_faces[0].descriptor)) {
                    descriptor_array[key] = value;
                }

                // Add descriptor to complete descriptor array
                descriptors.push(descriptor_array);
            }
        }

        // Resolve with a labelled face descriptor
        resolve(new faceapi.LabeledFaceDescriptors(name, descriptors));
    });
}
function update_node_descriptors(RED, id) {
    return new Promise((resolve, reject) => {
        try {
            let node = RED.nodes.getNode(id)
            if (node) node.load_descriptor();
            resolve();
        }
        catch (err) {
            reject(err);
        }
    });
}

// Export the main function
module.exports = function (RED, req, res) {
    return new Promise((resolve, reject) => {
        // Get all of the file data, inference each on a fork, and store the descriptors in a labelled file
        parse_input_form(req)
            .then(get_file_data, resolve.bind(null, 202))
            .then(get_descriptors.bind(null, req.params.id))
            .then(JSON.stringify)
            .then(writeFile.bind(null, join(global.descriptor_location, req.params.id + '.json')))
            .then(update_node_descriptors.bind(null, RED, req.params.id))
            .then(resolve.bind(null, 201))
            .catch(reject);
    });
}