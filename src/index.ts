import { mainLoopIteration } from "./model/MainLoop";

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