import axios from "axios";
import { getAEConversionData, reduceAEConversion } from "./AEConversion";
import { getIOBrokerValues } from "./IOBroker";


let lastReduceTimestamp = 0;

export async function mainLoopIteration() {
    const [ curValSmartMeter, curAEConversionValues] = await Promise.all([getIOBrokerValues(), getAEConversionData()]);

    try {
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.ae_conversion_0_power?value=${ Math.round( curAEConversionValues.currentPower )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.ae_conversion_0_limit?value=${ Math.round( curAEConversionValues.currentReduce )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.ae_conversion_0_efficency?value=${ Math.round( curAEConversionValues.currentEfficiency * 100 )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.victron_battery_power?value=${ Math.round( curValSmartMeter.batteryPower )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_consumption_bigger_zero?value=${ Math.round( curValSmartMeter.overallUsedPower > 0 ? curValSmartMeter.overallUsedPower : 0 )}`);   
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_real_consumption?value=${ Math.round( curValSmartMeter.overallUsedPower + curAEConversionValues.currentPower )}`);   
    } catch (err) {  }
    
    try {
    } catch (err) {  }

    return;
    
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
        if ( bNewReduceValue > 450 ) {
            bNewReduceValue = 450;
        }
        if ( bNewReduceValue > curAEConversionValues.currentReduce ) {
            console.log(`Increase from ${ curAEConversionValues.currentReduce }W to ${ bNewReduceValue }W, because overall used power is ${ curValSmartMeter.overallUsedPower }W` );

            return mainLoopReduce(0, bNewReduceValue);
        }
    } else if ( curValSmartMeter.overallUsedPower < -75 ) {
        //we have to decrease our inverter power..
        let bNewReduceValue = curAEConversionValues.currentPower + curValSmartMeter.overallUsedPower + 50;
        if ( bNewReduceValue > 450 ) {
            bNewReduceValue = 450;
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

    return reduceAEConversion(inverter, newVal);
}
