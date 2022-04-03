import { loadWHHistory } from "./model/IOBroker";
import { mainLoopIteration } from "./model/MainLoop";

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

mainLoop();