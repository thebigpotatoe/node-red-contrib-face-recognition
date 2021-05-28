// Load required modules
const { join, resolve } = require("path")

const load_models = require('../helpers/load_models');
const load_tfjs = require('../helpers/load_tfjs');

const faceapi = require('face-api.js');

const parse_model_options = require('../helpers/parse_model_options');
const parse_detection_options = require('../helpers/parse_detection_options');

const buffer2canvas = require('../helpers/buffer2canvas');
const detect_faces = require('../helpers/detect_faces');
const draw_faces = require("../helpers/draw_faces");

// Load in models and tf js globally
let models_loaded = false;
(async function () { load_tfjs(join()); })();
(async function () { models_loaded = await load_models(join(__dirname, '../weights')) })();

const { Image } = require('canvas');
let global_img = new Image;

// Create supporting functions
let convert_img_to_buffer = function (data) {
    return new Promise((resolve, reject) => {
        // Cast the input to a buffer 
        const buffer = Buffer.from(data);

        // Check the cast went successfully
        (!Buffer.isBuffer(buffer)) ? reject() : resolve(buffer);
    });
}
let compare_individual_descriptors = function (metric, labelled_descriptor, unknown_descriptor) {
    // Compare the incoming descriptor against this nodes descriptors
    let calculate_distances = Promise.all(labelled_descriptor._descriptors.map((known_descriptor) => {
        return new Promise((resolve, reject) => {
            let calculated_distance = Infinity;
            switch (metric) {
                case "Euclidean":
                    calculated_distance = Math.round(euclideanDistance(known_descriptor, unknown_descriptor) * 10000)
                    break;
                case "Manhattan":
                    calculated_distance = Math.round(manhattanDistance(known_descriptor, unknown_descriptor) * 1000)
                    break;
                case "Chebyshev":
                    calculated_distance = Math.round(chebyshevDistance(known_descriptor, unknown_descriptor) * 100000)
                    break;
                case "Mean Squared Error":
                    let sum = 0;
                    let length = 128;
                    for (i = 0; i < length; i += 1) {
                        var error = unknown_descriptor[i] - known_descriptor[i];
                        sum += error * error;
                    }
                    calculated_distance = Math.round(sum / length * 1000000)
                    break;
            }
            resolve(calculated_distance);
        });
    }))

    // Get the smallest value from the array of results and return the name based on score
    return calculate_distances.then((results) => {
        return { 'name': labelled_descriptor._label, 'distance': Math.min.apply(Math, results) };
    })
}
let compare_with_labelled_descriptors = function (metric, labelled_descriptors, unknown_descriptor) {
    return Promise.all(labelled_descriptors.map((labelled_descriptor) => {
        return new Promise((resolve, reject) => {
            compare_individual_descriptors(metric, labelled_descriptor, unknown_descriptor)
                .then(resolve)
                .catch(reject);
        });
    }));
}
let find_best_match = function (match_confidence, face, matches) {
    return new Promise((resolve, reject) => {
        // Setup a best match initial object
        let best_match = {
            "distance": Infinity
        };

        // Find the best match of all the recognise nodes
        for (const current_match of matches) {
            best_match = (best_match.distance > current_match.distance) ? current_match : best_match;
        }

        // Check if the best match is below the confidence level
        best_match.name = (best_match.distance < match_confidence) ? best_match.name : "Unknown";

        // Set the name and distance of the face from the best match
        face = { ...face, ...best_match };

        // Resolve the promise
        resolve(face);
    })
}
let recognise_faces = function (metric, match_confidence, labelled_descriptors, detections) {
    return Promise.all(detections.map((face) => {
        return new Promise((resolve, reject) => {
            return compare_with_labelled_descriptors(metric, labelled_descriptors, face.descriptor)
                .then(find_best_match.bind(null, match_confidence, face))
                .then(resolve)
                .catch(reject);
        });
    }));
}

process.on('message', async function (data) {
    try {
        // Log thr start time of inference
        let start_time = Date.now();

        // Extract the information from the data
        const { image, model_options, detect_options, descriptors, metric, match_confidence } = data;

        // If the models are yet to load, wait till they do, or kill the process if they don't
        let model_load_timer = setTimeout(() => { process.exit(); }, 30000);
        while (!models_loaded) { await new Promise(resolve => setTimeout(resolve, 10)); }
        clearTimeout(model_load_timer);

        // Convert the image from an array to canvas
        global_img = await convert_img_to_buffer(image.data)
            .then(buffer2canvas);

        // Parse input options from parent node
        let parsed_model_options = parse_model_options(model_options);
        let parsed_detect_options = parse_detection_options(detect_options);

        // Parse the descriptors from the passed json
        let parsed_descriptors = descriptors.map(x => faceapi.LabeledFaceDescriptors.fromJSON(x));

        // Convert the input to buffer, detect faces, and send back the results
        data['detected_faces'] = await detect_faces(parsed_model_options, parsed_detect_options, global_img)
            .then(recognise_faces.bind(null, metric, match_confidence, parsed_descriptors))

        // Draw on image 
        global_img = await draw_faces(detect_options, data.detected_faces, global_img)
        data.labelled_img = global_img.toBuffer('image/jpeg');

        // Log the total time for inference
        data['inference_time'] = Date.now() - start_time;

        // Send the data back as an object
        process.send(data);
    }
    catch (err) {
        console.error(err)
    }
});