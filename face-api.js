// Import required modules
const input_node = require('./app/nodes/input_node')
const recognise_node = require('./app/nodes/recognise_node')
const add_descriptors = require('./app/endpoints/add_descriptors');
const check_descriptors = require('./app/endpoints/check_descriptors');
const delete_descriptors = require('./app/endpoints/delete_descriptors');

// Set the global variables for the app
global.descriptor_location = require('path').join(__dirname, 'app/descriptors')

// Export the nodes
module.exports = function (RED) {
    // Recognise Node Constructor
    function recognise_node_creator(config) {
        recognise_node(RED, config, this)
    }
    RED.nodes.registerType("face-api-recognise", recognise_node_creator);

    // Input Node constructor
    function input_node_creator(config) {
        input_node(RED, config, this);
    }
    RED.nodes.registerType("face-api-input", input_node_creator)

    // HTTP Endpoints for use with the front end
    RED.httpAdmin.get('/faceapi/:id/check', RED.auth.needsPermission('face-api-recognise.upload'), async function (req, res) {
        RED.log.debug("Finding descriptors for " + req.params.id);
        check_descriptors(RED, req.params.id)
            .then((value) => {
                res.status(200).send(String(value)).end();
            })
            .catch((err) => {
                RED.log.error(err);
                res.status(200).send("0").end();
            })
    });
    RED.httpAdmin.post('/faceapi/:id/create', RED.auth.needsPermission('face-api-recognise.upload'), async function (req, res) {
        RED.log.debug("Attempting to create descriptors for " + req.params.id);
        add_descriptors(RED, req, res)
            .then((code) => {
                RED.log.info("Successfully created descriptors for " + req.params.id);
                res.status(code).send('OK').end();
            })
            .catch((err) => {
                RED.log.error(err);
                res.status(400).send(err).end();
            })
    });
    RED.httpAdmin.get('/faceapi/:id/delete', RED.auth.needsPermission('face-api-recognise.upload'), async function (req, res) {
        RED.log.debug("Attempting to delete descriptors for " + req.params.id);
        delete_descriptors(RED, req.params.id)
            .then((code) => {
                RED.log.info("Successfully deleted descriptors for " + req.params.id);
                res.status(201).send('OK').end();
                break;
            })
            .catch((err) => {
                RED.log.error(err);
                switch (err) {
                    case 400:
                        res.status(400).send('OK').end();
                        break;
                    case 404:
                        res.send("No node found matching " + req.params.id).status(404).end();
                        break;
                }
            })
    });
}