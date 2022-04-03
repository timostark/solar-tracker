import { CURRENT_SMART_METER_VALUES, getAEConversionData, reduceAEConversion } from "./AEConversion";
import { CURRENT_BATTERY_TREND, CURRENT_INJECTION_MODE, CURRENT_IO_BROKER_VALUES, fillWhHistory, getIOBrokerValues, updateIOBrokerValues } from "./IOBroker";


let lastIncreaseTimestamp = 0;
let lastReduceTimestamp = 0;
let counterMainIteration = 0;
let injectionMode = CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
let batteryTrend = CURRENT_BATTERY_TREND.CONSTANT;
let batteryStateOfChargeHistory : { [key: number] : number } = {};
const overallMaxValue = 500;


export async function mainLoopIteration() {
    let [ curValSmartMeter, curAEConversionValues] = await Promise.all([getIOBrokerValues(), getAEConversionData()]);

    batteryTrend = checkTrends(curValSmartMeter);
    curValSmartMeter.batteryTrend = batteryTrend;

    injectionMode = controlInjectionMode(curValSmartMeter);
    curValSmartMeter.injectionMode = injectionMode;

    fillWhHistory(curAEConversionValues, curValSmartMeter);

    try {
        if ( counterMainIteration % 5 === 0 ) {
            await updateIOBrokerValues(curAEConversionValues, curValSmartMeter);
        }
    } catch (err) {  }
    counterMainIteration ++;


    //get possible low and high value based on our injection mode..
    const limits = determineCurrentLimits( curAEConversionValues, curValSmartMeter );
    const curDate = new Date().getTime() / 1000;

    let newDynamicValue = curAEConversionValues.currentReduce;
    
    //is our current value unplausible? we are probably inside a change atm.. skip it..
    if ( curAEConversionValues.currentPower > curAEConversionValues.currentReduce * 1.02 ) {
        return;
    } else if ( curAEConversionValues.currentPower < curAEConversionValues.currentReduce * 0.8 ) {
        return;
    }

    if ( curValSmartMeter.overallUsedPower > -20 ) {
        //we have to increase our inverter power..
        let bNewReduceValue = curAEConversionValues.currentPower + curValSmartMeter.overallUsedPower + 50;
        if ( bNewReduceValue > overallMaxValue ) {
            bNewReduceValue = overallMaxValue;
        }
        if ( bNewReduceValue > curAEConversionValues.currentReduce ) {
            newDynamicValue = bNewReduceValue;
        }
    } else if ( curValSmartMeter.overallUsedPower < -75 ) {
        //we have to decrease our inverter power..
        let bNewReduceValue = curAEConversionValues.currentPower + curValSmartMeter.overallUsedPower + 50;
        if ( bNewReduceValue > overallMaxValue ) {
            bNewReduceValue = overallMaxValue;
        } else if ( bNewReduceValue < 30 ) {
            bNewReduceValue = 30;
        }

        if ( bNewReduceValue < curAEConversionValues.currentReduce ) {
            newDynamicValue = bNewReduceValue;
        }
    }

    if ( newDynamicValue > limits.max ) {
        newDynamicValue = limits.max;
    } else if ( newDynamicValue < limits.min ) {
        newDynamicValue = limits.min;
    }

    //we go up higher immediatly ( 2 seconds for plausability reasons) - lower we wait ~~20 seconds, just because the system is not behaving perfectly.. maybe we already jump up agan..
    if ( newDynamicValue > curAEConversionValues.currentReduce ) {
        if(!lastIncreaseTimestamp) {
            lastIncreaseTimestamp = new Date().getTime() / 1000;
        }
        if ( curDate - lastIncreaseTimestamp > 2 ) {
            await mainLoopReduce( 0, newDynamicValue);
            lastIncreaseTimestamp = null;
            lastReduceTimestamp = null;
        }
        await mainLoopReduce( 0, newDynamicValue);
    } else if ( newDynamicValue < curAEConversionValues.currentReduce ) {
        if(!lastReduceTimestamp) {
            lastReduceTimestamp = new Date().getTime() / 1000;
        }
        
        if ( curDate - lastReduceTimestamp > 20 ) {
            await mainLoopReduce( 0, newDynamicValue);
            lastReduceTimestamp = null;
            lastReduceTimestamp = null;
        }
    }
    
    return true;
}

async function mainLoopReduce(inverter: number, newVal: number) {
    return reduceAEConversion(inverter, newVal);
}

function getBatteryFromBefore(minTarget: number, fallback: number) {
    if ( minTarget < 0 ) {
        minTarget = 59 + minTarget;
    }
    if(!batteryStateOfChargeHistory[minTarget]) {
        return fallback;
    }
    return batteryStateOfChargeHistory[minTarget];
}

function checkTrends(curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    const curMin = new Date().getMinutes();
    batteryStateOfChargeHistory[curMin] = curValSmartMeter.batteryStateOfCharge;

    //get values before..
    const before15 = getBatteryFromBefore(curMin - 15, curValSmartMeter.batteryStateOfCharge);
    const before30 = getBatteryFromBefore(curMin - 30, curValSmartMeter.batteryStateOfCharge);
    const before45 = getBatteryFromBefore(curMin - 45, curValSmartMeter.batteryStateOfCharge);

    if ( before15 < curValSmartMeter.batteryStateOfCharge && before30 < before15 && before45 < before30 ) {
        return CURRENT_BATTERY_TREND.FAST_HIGHER;
    } else if ( before45 < curValSmartMeter.batteryStateOfCharge ) {
        return CURRENT_BATTERY_TREND.HIGHER;
    } else if ( before45 == curValSmartMeter.batteryStateOfCharge ) {
        return CURRENT_BATTERY_TREND.CONSTANT;
    } else if ( before45 > before30 && before30 > before15 && before15 > curValSmartMeter.batteryStateOfCharge ) {
        return CURRENT_BATTERY_TREND.FAST_LOWER;
    } else if ( before45 > curValSmartMeter.batteryStateOfCharge ) {
        return CURRENT_BATTERY_TREND.LOWER;
    }
    
    return CURRENT_BATTERY_TREND.CONSTANT;
}

function controlInjectionMode(curValSmartMeter: CURRENT_IO_BROKER_VALUES) : CURRENT_INJECTION_MODE {
    if ( injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH ) {
        if ( curValSmartMeter.batteryStateOfCharge < 20 ) {
            //stop - whatever our direction is - we are putting everything in the net, with less than 20% battery state..
            if ( batteryTrend === CURRENT_BATTERY_TREND.CONSTANT || batteryTrend === CURRENT_BATTERY_TREND.FAST_LOWER || batteryTrend === CURRENT_BATTERY_TREND.LOWER ) {
                return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
            }
            return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
        } else if ( curValSmartMeter.batteryStateOfCharge < 50 && batteryTrend === CURRENT_BATTERY_TREND.LOWER ) {
            return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
        } else if ( curValSmartMeter.batteryStateOfCharge < 75 && batteryTrend === CURRENT_BATTERY_TREND.FAST_LOWER ) {
            return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
        }
        
        return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH;
    }

    if ( injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW ) {
        if ( curValSmartMeter.batteryStateOfCharge > 20 && ( batteryTrend === CURRENT_BATTERY_TREND.FAST_HIGHER || batteryTrend === CURRENT_BATTERY_TREND.HIGHER ) ) {
            return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
        }
        return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
    }

    if ( injectionMode === CURRENT_INJECTION_MODE.DYNAMIC_INJECTION ) {
        if ( curValSmartMeter.batteryStateOfCharge < 20 ) {
            return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
        }
        if ( curValSmartMeter.batteryStateOfCharge > 40 && batteryTrend === CURRENT_BATTERY_TREND.FAST_HIGHER ) {
            return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH;
        }
        if ( curValSmartMeter.batteryStateOfCharge > 80 && batteryTrend === CURRENT_BATTERY_TREND.HIGHER ) {
            return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH;
        }
        if ( curValSmartMeter.batteryStateOfCharge > 90 ) {
            return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH;
        }
        return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
    }

    return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
}


function determineCurrentLimits(curAEConversionValues: CURRENT_SMART_METER_VALUES, curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    if ( curValSmartMeter.injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH ) {
        return {
            min: overallMaxValue,
            max: overallMaxValue
        }
    }
    
    if ( curValSmartMeter.injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW ) {
        if ( curValSmartMeter.batteryStateOfCharge > 50 ) {
            return {
                min: 200,
                max: 200
            };
        } else if ( curValSmartMeter.batteryStateOfCharge > 30 ) {
            return {
                min: 175,
                max: 175
            }
        } else if (curValSmartMeter.batteryStateOfCharge > 20 ) {
            return {
                min: 150,
                max: 150
            }
        } else if ( curValSmartMeter.batteryStateOfCharge > 15 ) {
            return {
                min: 100,
                max: 100
            }
        } else if ( curValSmartMeter.batteryStateOfCharge > 10 ) {
            return {
                min: 50,
                max: 50
            }
        } else {
            return {
                min: 0,
                max: 0,
            }
        }
    }
    
    if ( curValSmartMeter.injectionMode === CURRENT_INJECTION_MODE.DYNAMIC_INJECTION ) {
        return {
            min: 100,
            max: overallMaxValue
        }
    }
}