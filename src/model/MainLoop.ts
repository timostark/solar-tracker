import axios from "axios";
import { getAEConversionData, reduceAEConversion } from "./AEConversion";
import { getIOBrokerValues } from "./IOBroker";


let lastReduceTimestamp = 0;

export async function mainLoopIteration() {
    let [ curValSmartMeter, curAEConversionValues] = await Promise.all([getIOBrokerValues(), getAEConversionData()]);

    try {
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.ae_conversion_0_power?value=${ Math.round( curAEConversionValues.currentPower )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.ae_conversion_0_limit?value=${ Math.round( curAEConversionValues.currentReduce )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.ae_conversion_0_efficency?value=${ Math.round( curAEConversionValues.currentEfficiency * 100 )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.victron_battery_power?value=${ Math.round( curValSmartMeter.batteryPower )}`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_consumption_bigger_zero?value=${ Math.round( curValSmartMeter.overallUsedPower > 0 ? curValSmartMeter.overallUsedPower : 0 )}`);   
        
        const overAllConsumption = Math.round( curValSmartMeter.overallUsedPower + curAEConversionValues.currentPower );
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_real_consumption?value=${ overAllConsumption }`);   
        
        const usedPower = Math.round( curAEConversionValues.currentPower > overAllConsumption ? overAllConsumption : curAEConversionValues.currentPower );
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_used_consumption?value=${ usedPower }`);   

        const date = new Date( );
        const dateStr = date.toLocaleDateString('en-GB').split('/').reverse().join('');
        if ( curValSmartMeter.currentDay.toString() !== dateStr ) {
            if ( curValSmartMeter.currentCount !== 0 ) {
                
            }
            curValSmartMeter.currentAvg = 0;
            curValSmartMeter.currentCount = 0;

            //update current 
            curValSmartMeter.totalKwh = curValSmartMeter.totalKwh + curValSmartMeter.currentDayWh / 1000;

            axios.get(`http://192.168.178.81:8087/set/0_userdata.0.internal.ae_internal_total_kwh?value=${ dateStr }`);
        }
        curValSmartMeter.currentAvg = ( ( curValSmartMeter.currentAvg * curValSmartMeter.currentCount ) + usedPower ) / ( curValSmartMeter.currentCount + 1 );
        curValSmartMeter.currentCount += 1;
        
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.internal.ae_internal_measure_used_avg?value=${ curValSmartMeter.currentAvg }`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.internal.ae_internal_measure_count?value=${ curValSmartMeter.currentCount }`);

        //our current average of "injection" into the net is available - calculate missing hours..
        const injectionKwH = Math.round( curValSmartMeter.currentAvg * date.getHours() ) + ( curValSmartMeter.currentAvg * date.getMinutes() / 60, 0 );
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_current_day_used_kwh?value=${ injectionKwH }`);

        const totalKwhTotal = injectionKwH / 1000 + curValSmartMeter.totalKwh;
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_total_savings?value=${ totalKwhTotal * 0.33 }`);
        axios.get(`http://192.168.178.81:8087/set/0_userdata.0.house_total_used_kwh?value=${ totalKwhTotal }`);
    } catch (err) {  }
    
    try {
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

    return reduceAEConversion(inverter, newVal);
}
