import { CURRENT_SMART_METER_VALUES, getAEConversionData, reduceAEConversion } from "./AEConversion";
import { CURRENT_BATTERY_TREND, CURRENT_INJECTION_MODE, CURRENT_IO_BROKER_VALUES, fillWhHistory, getIOBrokerValues, updateIOBrokerValues } from "./IOBroker";
import controlMaxSolarPower from "./maxSolarPower";


let lastIncreaseTimestamp = 0;
let lastReduceTimestamp = 0;
let counterMainIteration = 0;
let injectionMode = CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
let batteryTrend = CURRENT_BATTERY_TREND.CONSTANT;
let batteryStateOfChargeHistory : { [key: number] : number } = {};
let solarPowerChargeHistory : { [key: number] : number } = {};
let solarPowerAverageLastHour = 0;
let currentReduceTarget = -1;
let currentReduceTargetTstmp : Date = null;
let currentlyInReduceMode = false;
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

    controlMaxSolarPower(curAEConversionValues, curValSmartMeter);
    if ( currentReduceTarget === -1 ) {
        currentReduceTarget = curAEConversionValues.currentReduce;
    }

    //hard: avoid to make our battery empty..
    if ( curValSmartMeter.batteryStateOfCharge < 8 ) {
        //reset to zero..
        currentReduceTarget = 0;

        await mainLoopReduce( 0, 0 );
        return;
    }

    //get possible low and high value based on our injection mode..
    const limits = determineCurrentLimits( curAEConversionValues, curValSmartMeter );
    
    let newLimitValue = curAEConversionValues.currentReduce;

    //sanity check (1): Is our current reduce target accepted already?
    if ( curAEConversionValues.currentReduce !== currentReduceTarget ) {
        //maybe this was adjusted from the outside.. give it 10 seconds to adjust - before that do nothing..
        if(!currentReduceTargetTstmp) {
            currentReduceTargetTstmp = new Date();
        }
        if( currentReduceTargetTstmp.getTime() / 1000 + 10 > new Date().getTime() / 1000 ) {
            return;
        }

        currentReduceTarget = curAEConversionValues.currentReduce;
    }
    currentReduceTargetTstmp = null;

    //sanity check (2): After adjusting the value sometimes aeconversion just needs a little time to follow it..
    //we wont send an additional adjustment before the current one is not respected..
    if ( curAEConversionValues.currentPower > curAEConversionValues.currentReduce * 1.02 ) {
        return;
    } else if ( curAEConversionValues.currentPower < curAEConversionValues.currentReduce * 0.8 ) {
        return;
    }


    if ( curValSmartMeter.overallUsedPower >= -50 ) {
        currentlyInReduceMode = false;
    }

    if ( curValSmartMeter.overallUsedPower > 0 ) {
        //we should increase the overall used power.. but if we do it immediatly or just skip a minimal spike depends..
        if ( curValSmartMeter.overallUsedPower < 100 ) { //for small steps.. wait for 5 seconds if that things goes over or not..
            if(!lastIncreaseTimestamp) {
                lastIncreaseTimestamp = new Date().getTime() / 1000;
            }
            if ( lastIncreaseTimestamp + 5 > new Date().getTime() / 1000 ) {
                return;
            }
        }

        lastIncreaseTimestamp = null;
        
        //we either waited for 5 seconds, or our increase value is >= 100 --> go ahead..
        let newIncreaseValue = getNextValidPowerValueFor(curAEConversionValues.currentPower + curValSmartMeter.overallUsedPower);
        if ( newIncreaseValue > overallMaxValue ) {
            newIncreaseValue = overallMaxValue;
        }
        if ( newIncreaseValue > curAEConversionValues.currentReduce ) {
            newLimitValue = newIncreaseValue;
        }
    } else if ( curValSmartMeter.overallUsedPower < -50 ) {
        //decreasing takes a little bit more steps.. we will not decrease immed
        if ( curValSmartMeter.overallUsedPower > -100 && currentlyInReduceMode === false ) { //"just" 100w decrease.. give it 15 seconds..
            if(!lastReduceTimestamp) {
                lastReduceTimestamp = new Date().getTime() / 1000;
            }
            if ( lastReduceTimestamp + 15 > new Date().getTime() / 1000 ) {
                return;
            }
        }
        currentlyInReduceMode = true;
        lastReduceTimestamp = null;

        let newReduceValue = getNextValidPowerValueFor( curAEConversionValues.currentPower + curValSmartMeter.overallUsedPower );
        if ( newReduceValue > overallMaxValue ) {
            newReduceValue = overallMaxValue;
        } else if ( newReduceValue < 30 ) {
            newReduceValue = 30;
        }

        if ( newReduceValue < curAEConversionValues.currentReduce ) {
            //small problem with aeconversion: reducing too much leads to a "crash" to 0... therefore we are "simply" reducing by a max of 10..
            //the next step will increase again ofc..
            
            newLimitValue = ( Math.floor(curAEConversionValues.currentReduce / 10) - 1 ) * 10;
        }
    }

    if ( newLimitValue > limits.max ) {
        newLimitValue = limits.max;
    } else if ( newLimitValue < limits.min ) {
        newLimitValue = limits.min;
    }

    //we go up higher immediatly ( 2 seconds for plausability reasons) - lower we wait ~~20 seconds, just because the system is not behaving perfectly.. maybe we already jump up agan..
    if ( newLimitValue > curAEConversionValues.currentReduce ) {
        currentReduceTarget = newLimitValue;
        await mainLoopReduce( 0, newLimitValue);
    } else if ( newLimitValue < curAEConversionValues.currentReduce ) {
        currentReduceTarget = newLimitValue;
        await mainLoopReduce( 0, newLimitValue);
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
    solarPowerChargeHistory[curMin] = curValSmartMeter.solarPower;

    //build up the average..
    for ( var i=0;i<60;i++) {
        solarPowerAverageLastHour = solarPowerAverageLastHour + ( solarPowerChargeHistory[i] || 0 );
    }
    solarPowerAverageLastHour = solarPowerAverageLastHour / 60;

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
        } else if ( curValSmartMeter.batteryStateOfCharge < 90 && batteryTrend === CURRENT_BATTERY_TREND.FAST_LOWER && solarPowerAverageLastHour < 300 ) {
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
        if ( curValSmartMeter.batteryStateOfCharge > 35 && batteryTrend === CURRENT_BATTERY_TREND.FAST_HIGHER && solarPowerAverageLastHour > 1000 ) {
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

function getNextValidPowerValueFor(val: number) {
    //we are always jumping in 50 steps..
    let adjustedVal = ( Math.floor(val / 50) + 1 ) * 50;
    return adjustedVal;
}