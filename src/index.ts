import { loadWHHistory } from "./model/IOBroker";
import { mainLoopIteration, setMinMaxGlobalOverwrite, setModeGlobalOverwrite } from "./model/MainLoop";

loadWHHistory();

function mainLoop() {
    setTimeout(async () => {
        try {
            await mainLoopIteration();
        } catch(err) {

        } finally {
            mainLoop();
        }
    },1000);
}


import express from "express";

const app = express();

app.get('/clear', (req, res) => {

    setMinMaxGlobalOverwrite(null,null);
    setModeGlobalOverwrite(null);
    
    res.send("OK");
});

app.get('/setMinMax', (req, res) => {
    const min = req.param("min");
    const max = req.param("max");
    const mode = req.param("mode");

    if ( min || max ) {
        setMinMaxGlobalOverwrite(parseInt(min), parseInt(max));
    }

    if ( mode ) {
        setModeGlobalOverwrite(mode);
    }

    res.send("OK");
});

app.listen(3010, () => {

});

mainLoop();