# bobby-websocket


## Example payload for bobbycar
```json
{
    "type":"comred",
    "name":"bobby",
    "res":"240x320",
    "pass":"Passwort123",
    "key":"server_key"
}
```

```jsonc
// bobbycar login
{"type": "hello", "name": "comred", "res": "240x320", "pass": "Passwort123", "key": "server_key"}

// login from webinterface
{"type": "login", "user": "comred_new", "pass": "Passwort123"}

// send message
{"type": "msg", "msg": "Hello World"}
{"type": "popup", "msg": "Hello World"}

// list all bobbycars
{"type": "list_available"}

// draw pixel
{"type":"drawPixel", "x":100, "y":100, "c":"#fff"}

// fill rectangle
{"type":"fillRect", "x":10, "y": 10, "w": 10, "h": 10, "c": "#f00"}

// draw rectangle (just border)
{"type":"drawRect","x":10,"y":10,"w":100,"h":100,"c":"#f00"}

// drawing a line
{"type":"drawLine","x1":10,"y1":10,"x2":20,"y2":20,"c":"#f00"}