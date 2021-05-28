// Load used modules
const { join } = require('path')
const { readFile, unlink, stat } = require("fs").promises;
const faceapi = require('face-api.js');
const euclideanDistance = require('euclidean')
const manhattanDistance = require('manhattan')
const chebyshevDistance = require('chebyshev')

const { isArray } = require('../helpers/type_checks');

// Export the main function class for teh node
module.exports = function (RED, config, node) {
    // Register node with node red
    RED.nodes.createNode(node, config);

    // Node variables 
    node.name = config.name || "face-api-compute";
    node.descriptors = null;
    node._filename = join(global.descriptor_location, node.id + ".json");

    // Create supporting functions
    node.load_descriptor = function () {
        stat(node._filename)
            .then(readFile.bind(this, node._filename))
            .then(JSON.parse)
            .then((file) => {
                node.descriptors = faceapi.LabeledFaceDescriptors.fromJSON(file);
                node.descriptors._label = node.name;
            })
            .catch((err) => {
                node.descriptors = null;
                RED.log.error("No descriptor file found for " + String(node.id))
            });
    }
    node.delete_descriptor = function () {
        stat(node._filename)
            .then(unlink(node._filename))
            .catch((err) => {
                node.descriptors = null;
                RED.log.error("No descriptor file to delete for " + String(node.id))
            });
    }
    node.get_descriptor = function () {
        return new Promise((resolve, reject) => {
            resolve(node.descriptors)
        });
    }

    // Clean up the node when closed
    node.on('close', function (removed, done) {
        // delete descriptor here
        if (removed) node.delete_descriptor();
        done();
    });

    // Load in the descriptors at start
    node.load_descriptor();
}