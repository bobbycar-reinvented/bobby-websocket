import { WebSocketServer } from 'ws';
import { createServer } from 'http';
const httpServer = createServer();
import * as _uuid from 'uuid';
const uuid = _uuid.v4;
import { config } from 'dotenv';
const env = config().parsed;
import express from 'express';
const app = express();

import ipc from 'node-ipc'

ipc.config.id = 'bobby_websocket';
ipc.config.retry = 1500;
ipc.config.silent = true;

let connectedBobbycars = [];
let connectedWebClients = [];

const websocket = new WebSocketServer({
    clientTracking: true,
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        },

        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
    },
    noServer: true
});

function rgbToHex(rgb) {
    return '#' + rgb.map(function (c) {
        return ('0' + c.toString(16)).slice(-2);
    }).join('');
}

function rgb565_2_888(rgb565) {
    let r = (rgb565 >> 11) & 0x1F;
    let g = (rgb565 >> 5) & 0x3F;
    let b = rgb565 & 0x1F;

   return rgbToHex([r << 3, g << 2, b << 3]);
}

function sendError(err, ws, type = 'error') {
    console.error(err);
    ws.send(JSON.stringify({
        type,
        error: err
    }));
}

function sendErrorToAllClients(err, type) {
    console.error(err);
    sendToAllConnectedClients(JSON.stringify({
        type,
        error: err
    }));
}

function sendToAllConnectedClients(ws, packet) {
    connectedWebClients.forEach(client => {
        if(client.name === ws.name) {
            if (typeof packet === 'string') {
                client.send(packet);
            } else {
                client.send(JSON.stringify(packet));
            }
        }
    });
}

function sendToAllClients(packet) {
    connectedWebClients.forEach(client => {
        client.send(packet);
    });
}

function convertDisplayData(string) {
    console.log(string);
}

websocket.on('connection', (ws, req) => {

    ws.authenticated = false;
    ws.id = uuid();

    ws.on('error', console.error);

    ws.on('close', (code, reason) => {
        reason = reason.toString() ? reason.toString() : 'Bobbycar Disconnected';

        console.info(`closed connection ${ws.id}`);
        if (ws.hasOwnProperty('name') && ws.type == 'bobbycar') {

            console.log(`Bobbycar Connection closed: ${code} ${reason} (Name: ${ws.name})`);

            // Remove from connectedBobbycars
            connectedBobbycars = connectedBobbycars.filter(bobbycar => bobbycar.id != ws.id);

            // disconnect all clients connected to this bobbycar
            let message = JSON.stringify({
                type: 'disconnect',
                code,
                reason: reason.toString(),
            })
            
            // Send bobbycar disconnect message to all connected clients
            sendToAllConnectedClients(ws, message);

        } else if (ws.type == 'client') {
            console.log(`Client Connection closed: ${code} ${reason} (Client IP: ${req.headers['x-forwarded-for'] || req.socket.remoteAddress})`);
            connectedWebClients = connectedWebClients.filter(client => client.id !== ws.id);
        } else {
            console.log(`Connection closed from unknown source: ${code} ${reason} (Client IP: ${req.headers['x-forwarded-for'] || req.socket.remoteAddress})`);
        }
    });

    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            if (ws.type === 'bobbycar') {
                sendToAllConnectedClients(ws, data);
            } else if(ws.type === 'client') {
                sendError('Clients are not allowed to send binary messages', ws, 'warning');
            }
            return;
        }

        let message = data.toString();

        if (message.length < 5)
            return;

        if (!message.startsWith('{')) {
            // display command
            convertDisplayData(message);
            return;
        }

        try {
            data = JSON.parse(data.toString())
        } catch (err) {
            console.warn(`Tried to parse "${message}" as JSON`);
            sendErrorToAllClients("Could not parse JSON", "bobbyerror");
            return;
        }

        switch (data.type) {
            case 'hello':
                {

                    if (ws.authenticated) {
                        return;
                    }

                    if (!data.hasOwnProperty('key')) {
                        // sendError("Missing key", ws);
                        return;
                    }

                    if (!data.hasOwnProperty('name')) {
                        console.log("No name given");
                        // sendError("No name given", ws);
                        return;
                    }

                    if (!data.hasOwnProperty('res')) {
                        console.log("No resolution given");
                        // sendError("No resolution given", ws);
                        return;
                    }

                    if (!data.hasOwnProperty('pass')) {
                        console.log("No password given");
                        // sendError("No password given", ws);
                        return;
                    }

                    if (data.key != env.WEBSOCKET_AUTH_KEY) {
                        // sendError("Invalid key", ws);
                        return;
                    } else {
                        ws.authenticated = true;
                    }

                    console.log(`Authenticated ${data.name}`);

                    let bobbycar = {
                        name: data.name,
                        res: data.res,
                        pass: data.pass,
                        ws: ws,
                        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
                        port: req.socket.remotePort,
                        id: ws.id
                    }

                    ws.type = 'bobbycar';
                    ws.name = data.name;
                    ws.last_ping = Date.now();
                    ws.heartbeat = setInterval(() => {
                        const now = Date.now();
                        // disconnect after 5 seconds
                        if (now - ws.last_ping > 5000) {
                            console.log(`Bobbycar ${ws.name} timed out (${now - ws.last_ping}ms)`);
                            ws.close(1000, 'Bobbycar timed out');
                            sendToAllConnectedClients(ws, JSON.stringify({
                                type: 'disconnect',
                                code: 1000,
                                reason: 'Bobbycar timed out'
                            }));
                            clearInterval(ws.heartbeat);
                            connectedBobbycars = connectedBobbycars.filter(bobbycar => bobbycar.id != ws.id);
                            return;
                        }
                        sendToAllConnectedClients(ws, JSON.stringify({
                            type: 'bobbycar-ping',
                            time: now - ws.last_ping
                        }));
                    }, 500);

                    // if bobbycar exists, delete old one and replace with new one
                    let oldBobbycar = connectedBobbycars.find(bobbycar => bobbycar.name == data.name);
                    if (oldBobbycar) {
                        console.log(`Bobbycar ${oldBobbycar.name} already exists, replacing with new one`);
                        connectedBobbycars = connectedBobbycars.filter(bobbycar => bobbycar.name != oldBobbycar.name);
                    }

                    // Add bobbycar to connectedBobbycars
                    connectedBobbycars.push(bobbycar);
                    break;
                }

            case 'heartbeat':
            {
                if (ws.type !== 'bobbycar') {
                    return;
                }

                ws.last_ping = Date.now();
                break;   
            }

            case 'list-available':
                if (!ws.authenticated) {
                    sendError("Client not authenticated", ws);
                    return;
                }

                ws.send(JSON.stringify({
                    type: 'list-available',
                    bobbycars: connectedBobbycars.map(bobbycar => {
                        return {
                            name: bobbycar.name,
                            ip: bobbycar.ip,
                            res: bobbycar.res
                        }
                    })
                }) || '{}');
                break;

            case 'login':
                {
                    if (!data.hasOwnProperty('user')) {
                        console.log("No user given");
                        sendError("No user given", ws);
                        return;
                    }

                    if (!data.hasOwnProperty('pass')) {
                        console.log("No password given");
                        sendError("No password given", ws, 'loginError');
                        return;
                    }

                    let bobbycar = connectedBobbycars.find(bobbycar => bobbycar.name === data.user);
                    if (bobbycar) {
                        if (bobbycar.pass === data.pass) {
                            console.log("Client logged in as " + bobbycar.name);
                            ws.send(JSON.stringify({
                                type: 'login',
                                name: bobbycar.name,
                                ip: bobbycar.ip,
                                res: bobbycar.res
                            }));
                            ws.authenticated = true;
                            ws.type = 'client';
                            ws.name = bobbycar.name;
                            connectedWebClients.push(ws);
                        } else {
                            console.log("Wrong password for " + bobbycar.name);
                            sendError("Incorrect data", ws, 'loginError');
                        }
                    } else {
                        console.log("Bobbycar " + data.user + " not connected");
                        sendError("Bobbycar offline", ws, 'loginError');
                    }
                    break;
                }

            case 'msg':
            case 'popup':
            case 'response':
            case 'getConfig':
            case 'getSingleConfig':
            case 'setConfig':
            case 'resetConfig':
            case 'getInformation':
            case 'getUptime':
            case 'getOtaStatus':
            case 'rawBtnPrssd':
            case 'btnPressed':
            case 'initScreen':
                if (!ws.authenticated) {
                    sendError("Client not authenticated", ws);
                    return;
                }

                if (['msg', 'popup'].includes(data.type) && !data.hasOwnProperty('msg')) {
                    console.log("No message given");
                    sendError("No message given", ws);
                    return;
                }

                if (['setConfig', 'getSingleConfig', 'resetConfig'].includes(data.type) && !data.hasOwnProperty('nvskey')) {
                    console.log("No nvskey given");
                    sendError("No nvskey given", ws);
                    return;
                }

                if (['setConfig'].includes(data.type) && !data.hasOwnProperty('value')) {
                    console.log("No value given");
                    sendError("No value given", ws);
                    return;
                }

                if (['rawBtnPrssd', 'btnPressed'].includes(data.type) && !data.hasOwnProperty('btn')) {
                    console.log("No button given");
                    sendError("No button given", ws);
                    return;
                }

                // if (!data.hasOwnProperty('info') && ['getInformation', 'getUptime'].includes(data.type)) {
                //     console.log("No info given");
                //     sendError("No info given", ws);
                //     return;
                // }

                if (data.type === 'initScreen')
                {
                    console.log("Initializing screen");
                }

                if (ws.type === 'bobbycar') {
                    sendToAllConnectedClients(ws, JSON.stringify({
                        type: data.type,
                        msg: data.msg,
                        id: data.id
                    }));
                } else {
                    let bobbycar = connectedBobbycars.find(bobbycar => bobbycar.name === ws.name);
                    if (bobbycar) {
                        const packet = {
                            type: data.type,
                            id: data.id
                        };

                        if (data.hasOwnProperty('msg')) {
                            packet.msg = data.msg;
                        }

                        if (data.hasOwnProperty('nvskey')) {
                            packet.nvskey = data.nvskey;
                        }

                        if (data.hasOwnProperty('value')) {
                            packet.value = data.value;
                        }

                        if (data.hasOwnProperty('btn')) {
                            packet.btn = data.btn;
                        }

                        // if (data.hasOwnProperty('info')) {
                        //     packet.info = data.info;
                        // }

                        bobbycar.ws.send(JSON.stringify(packet));
                    } else {
                        console.log("Bobbycar " + data.dest + " not connected");
                        sendError("Bobbycar not connected", ws);
                    }
                }
                break;
            default: {

                if (!ws.authenticated) {
                    sendError("Client not authenticated", ws);
                    return;
                }

                if (ws.type === 'bobbycar' && data.hasOwnProperty('type')) {
                    sendToAllConnectedClients(ws, data);
                }
                break;
            }
        }
    });
});

app.get('/listAvailable', (req, res) => {
    res.json(connectedBobbycars.map(bobbycar => {
        return {
            name: bobbycar.name,
            ip: bobbycar.ip,
            res: bobbycar.res,
            pass: bobbycar.pass
        }
    }));
});

httpServer.on('upgrade', (req, socket, head) => {
    websocket.handleUpgrade(req, socket, head, (ws) => {
        websocket.emit('connection', ws, req);
    });
})

ipc.connectTo('bobby_insert_v2', () => {
    ipc.of.bobby_insert_v2.on('udp_data', (data) => {
        try {
            const parsed = JSON.parse(data);
            const { username, message } = parsed;

            const clients = connectedWebClients.filter((client) => { return client.name === username });
            for (const client of clients) {
                client.send(JSON.stringify({ type: 'udpmessage', data: message }));
            }
        } catch {}
    });
});

httpServer.listen(42429, '127.0.0.1');
app.listen(42431, '127.0.0.1');

console.log('Server started on port 42429');
