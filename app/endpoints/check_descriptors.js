// Load required modules
const { readFile } = require("fs").promises
const { join } = require("path")

const get_descriptor_location = function (RED, id) {
    return new Promise((resolve, reject) => {
        let node = RED.nodes.getNode(id);
        (node) ? resolve(join(global.descriptor_location, id + '.json')) : reject();
    });
}

// Export the main endpoint
module.exports = async function (RED, id) {
    return new Promise(async function (resolve, reject) {
        get_descriptor_location(RED, id)
            .then(readFile)
            .then(JSON.parse)
            .then((array) => {return array.descriptors.length || 0})
            .then(resolve)
            .catch(reject);
    });
}