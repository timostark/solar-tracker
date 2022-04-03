import { getAEConversionData, reduceAEConversion } from "./AEConversion";
import { getIOBrokerValues, updateIOBrokerValues } from "./IOBroker";


let lastReduceTimestamp = 0;
let counterMainIteration = 0;

export async function mainLoopIteration() {
    let [ curValSmartMeter, curAEConversionValues] = await Promise.all([getIOBrokerValues(), getAEConversionData()]);

    
    try {
        //update iobroker every 5 seconds only
        if ( counterMainIteration % 5 === 0 ) {
            await updateIOBrokerValues(curAEConversionValues, curValSmartMeter);
        }
    } catch (err) {  }

    const curDate = new Date().getTime() / 1000;

    //we do not want moe changes than every 60 seconds as aeconversion simply takes a while to react..
    if ( curDate - lastReduceTimestamp < 60 ) {
        return;
    }

    if ( curValSmartMeter.batteryStateOfCharge < 15 ) {
        //stop aeconversion - we do not want to clean up the battery
        if ( curAEConversionValues.currentReduce > 0 ) {
            console.log(`Battery has only ${ curValSmartMeter.batteryStateOfCharge }% left, therefore shutting down..` );

            return mainLoopReduce(0,0);
        }
    } else if ( curValSmartMeter.overallUsedPower > -20 ) {
        //we have to increase our inverter power..
        let bNewReduceValue = curAEConversionValues.currentPower + curValSmartMeter.overallUsedPower + 50;
        if ( bNewReduceValue > 500 ) {
            bNewReduceValue = 500;
        }
        if ( bNewReduceValue > curAEConversionValues.currentReduce ) {
            console.log(`Increase from ${ curAEConversionValues.currentReduce }W to ${ bNewReduceValue }W, because overall used power is ${ curValSmartMeter.overallUsedPower }W` );

            return mainLoopReduce(0, bNewReduceValue);
        }
    } else if ( curValSmartMeter.overallUsedPower < -75 ) {
        //we have to decrease our inverter power..
        let bNewReduceValue = curAEConversionValues.currentPower + curValSmartMeter.overallUsedPower + 50;
        if ( bNewReduceValue > 500 ) {
            bNewReduceValue = 500;
        } else if ( bNewReduceValue < 30 ) {
            bNewReduceValue = 30;
        }

        if ( bNewReduceValue < curAEConversionValues.currentReduce ) {
            console.log(`Reduce from ${ curAEConversionValues.currentReduce }W to ${ bNewReduceValue }W, because overall used power is ${ curValSmartMeter.overallUsedPower }W` );
            return mainLoopReduce(0, bNewReduceValue);
        }
    }
    return true;
}

async function mainLoopReduce(inverter: number, newVal: number) {
    lastReduceTimestamp = new Date().getTime() / 1000;
    counterMainIteration ++;

    return reduceAEConversion(inverter, newVal);
}
