import { CURRENT_SMART_METER_VALUES, getAEConversionData, reduceAEConversion } from "./AEConversion";
import { CURRENT_BATTERY_TREND, CURRENT_INJECTION_MODE, CURRENT_IO_BROKER_VALUES, fillWhHistory, getIOBrokerValues, updateIOBrokerValues, VE_BUS_STATE } from "./IOBroker";
import setCurrentTargetValue, { disableOvervoltageFeedIn } from "./maxSolarPower";
import controlMaxSolarPower from "./maxSolarPower";


let lastIncreaseTimestamp = 0;
let lastReduceTimestamp = 0;
let counterMainIteration = 0;
let injectionMode = CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
let batteryTrend = CURRENT_BATTERY_TREND.CONSTANT;
let batteryStateOfChargeHistory: { [key: number]: number } = {};
let solarPowerChargeHistory: { [key: number]: number } = {};
let solarPowerAverageLastHour = 0;
let currentEssTarget = -1;
let currentReduceTargetTstmp: Date = null;
let currentlyInReduceMode = false;
let globalRestrictionMin = null;
let globalIncreaseValue = false;
let globalRestrictionMax = null;
let globalRestrictionMode: CURRENT_INJECTION_MODE = null;

const minValueForConstantHighMode = 500;
const overallMaxValue = 1100;


export async function mainLoopIteration() {
    let curValSmartMeter = await getIOBrokerValues();

    batteryTrend = checkTrends(curValSmartMeter);
    curValSmartMeter.batteryTrend = batteryTrend;

    injectionMode = controlInjectionMode(curValSmartMeter);
    if (globalRestrictionMode) {
        injectionMode = globalRestrictionMode;
    }
    curValSmartMeter.injectionMode = injectionMode;

    if (curValSmartMeter.overvoltageFeedIn === 0) {
        await disableOvervoltageFeedIn();
    }

    fillWhHistory(curValSmartMeter);

    try {
        //if (counterMainIteration % 5 === 0) {
        await updateIOBrokerValues(curValSmartMeter);
        //}
    } catch (err) { }
    counterMainIteration++;

    //controlMaxSolarPower(curValSmartMeter);

    if (currentEssTarget === -1) {
        currentEssTarget = curValSmartMeter.currentEssTarget;
    }

    //hard: avoid to make our battery empty..
    if (curValSmartMeter.batteryStateOfCharge < 8) {
        //reset to zero..
        currentEssTarget = 0;

        await mainLoopReduce(0);
        return;
    }

    //absolutly ensure that we are changing the value very 20 seconds to avoid falling back to passtru
    if (counterMainIteration % 20 === 0) {
        const addVal = globalIncreaseValue === true ? 1 : -1;
        globalIncreaseValue = globalIncreaseValue === false;
        await mainLoopReduce(curValSmartMeter.currentEssTarget + addVal);
        return; //avoid double setting.. next run will anyhow set it..
    }

    //get possible low and high value based on our injection mode..
    const limits = determineCurrentLimits(curValSmartMeter);

    let newLimitValue = curValSmartMeter.currentEssTarget;

    //sanity check (1): Is our current reduce target accepted already?
    if (curValSmartMeter.currentEssTarget !== currentEssTarget) {
        //maybe this was adjusted from the outside.. give it 10 seconds to adjust - before that do nothing..
        if (!currentReduceTargetTstmp) {
            currentReduceTargetTstmp = new Date();
        }
        if (currentReduceTargetTstmp.getTime() / 1000 + 10 > new Date().getTime() / 1000) {
            return;
        }

        currentEssTarget = curValSmartMeter.currentEssTarget;
    }
    currentReduceTargetTstmp = null;

    if (curValSmartMeter.vebusState === VE_BUS_STATE.FAULT) {
        return;
    }

    //sanity check (2): After adjusting the value sometimes aeconversion just needs a little time to follow it..
    //we wont send an additional adjustment before the current one is not respected..
    /*if (curValSmartMeter.vebusState !== VE_BUS_STATE.PASSTHRU) {
        if (curValSmartMeter.currentPower > curValSmartMeter.currentEssTarget * 1.02 && Math.abs(curValSmartMeter.currentPower - curValSmartMeter.currentEssTarget) > 5) {
            return;
        } else if (curValSmartMeter.currentPower < curValSmartMeter.currentEssTarget * 0.8 && Math.abs(curValSmartMeter.currentPower - curValSmartMeter.currentEssTarget) > 5) {
            return;
        }
    }*/


    if (curValSmartMeter.overallUsedPower >= -50) {
        currentlyInReduceMode = false;
    }

    if (curValSmartMeter.overallUsedPower > 0) {
        //we should increase the overall used power.. but if we do it immediatly or just skip a minimal spike depends..
        if (curValSmartMeter.overallUsedPower < 100) { //for small steps.. wait for 5 seconds if that things goes over or not..
            if (!lastIncreaseTimestamp) {
                lastIncreaseTimestamp = new Date().getTime() / 1000;
            }
            if (lastIncreaseTimestamp + 5 > new Date().getTime() / 1000) {
                return;
            }
        }

        lastIncreaseTimestamp = null;

        //we either waited for 5 seconds, or our increase value is >= 100 --> go ahead..
        let newIncreaseValue = getNextValidPowerValueFor(curValSmartMeter.actualMultiPlusPower + curValSmartMeter.overallUsedPower);
        if (newIncreaseValue > overallMaxValue) {
            newIncreaseValue = overallMaxValue;
        }
        if (newIncreaseValue > curValSmartMeter.currentEssTarget) {
            newLimitValue = newIncreaseValue;
        }
    } else if (curValSmartMeter.overallUsedPower < -50) {
        //decreasing takes a little bit more steps.. we will not decrease immed
        if (curValSmartMeter.overallUsedPower > -100 && currentlyInReduceMode === false) { //"just" 100w decrease.. give it 15 seconds..
            if (!lastReduceTimestamp) {
                lastReduceTimestamp = new Date().getTime() / 1000;
            }
            if (lastReduceTimestamp + 15 > new Date().getTime() / 1000) {
                return;
            }
        }
        currentlyInReduceMode = true;
        lastReduceTimestamp = null;

        let newReduceValue = getNextValidPowerValueFor(curValSmartMeter.actualMultiPlusPower + curValSmartMeter.overallUsedPower);
        if (newReduceValue > overallMaxValue) {
            newReduceValue = overallMaxValue;
        } else if (newReduceValue < 30) {
            newReduceValue = 30;
        }

        newLimitValue = newReduceValue;
    }

    if (newLimitValue > limits.max) {
        newLimitValue = limits.max;
    } else if (newLimitValue < limits.min) {
        newLimitValue = limits.min;
    }

    if (globalRestrictionMax !== null && newLimitValue > globalRestrictionMax) {
        newLimitValue = globalRestrictionMax;
    }

    if (globalRestrictionMin !== null && newLimitValue < globalRestrictionMin) {
        newLimitValue = globalRestrictionMin;
    }

    //we go up higher immediatly ( 2 seconds for plausability reasons) - lower we wait ~~20 seconds, just because the system is not behaving perfectly.. maybe we already jump up agan..
    if (newLimitValue > curValSmartMeter.currentEssTarget) {
        currentEssTarget = newLimitValue;
        await mainLoopReduce(newLimitValue);
    } else if (newLimitValue < curValSmartMeter.currentEssTarget) {
        currentEssTarget = newLimitValue;
        await mainLoopReduce(newLimitValue);
    }

    return true;
}

async function mainLoopReduce(newVal: number) {
    return setCurrentTargetValue(newVal);
}

function getBatteryFromBefore(minTarget: number, fallback: number) {
    if (minTarget < 0) {
        minTarget = 59 + minTarget;
    }
    if (!batteryStateOfChargeHistory[minTarget]) {
        return fallback;
    }
    return batteryStateOfChargeHistory[minTarget];
}

function checkTrends(curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    const curMin = new Date().getMinutes();
    batteryStateOfChargeHistory[curMin] = curValSmartMeter.batteryStateOfCharge;
    solarPowerChargeHistory[curMin] = curValSmartMeter.solarPower;

    //build up the average..
    for (var i = 0; i < 60; i++) {
        solarPowerAverageLastHour = solarPowerAverageLastHour + (solarPowerChargeHistory[i] || 0);
    }
    solarPowerAverageLastHour = solarPowerAverageLastHour / 60;

    //get values before..
    const before15 = getBatteryFromBefore(curMin - 15, curValSmartMeter.batteryStateOfCharge);
    const before30 = getBatteryFromBefore(curMin - 30, curValSmartMeter.batteryStateOfCharge);
    const before45 = getBatteryFromBefore(curMin - 45, curValSmartMeter.batteryStateOfCharge);

    if (before15 < curValSmartMeter.batteryStateOfCharge && before30 < before15 && before45 < before30) {
        return CURRENT_BATTERY_TREND.FAST_HIGHER;
    } else if (before45 < curValSmartMeter.batteryStateOfCharge) {
        return CURRENT_BATTERY_TREND.HIGHER;
    } else if (before45 == curValSmartMeter.batteryStateOfCharge) {
        return CURRENT_BATTERY_TREND.CONSTANT;
    } else if (before45 > before30 && before30 > before15 && before15 > curValSmartMeter.batteryStateOfCharge) {
        return CURRENT_BATTERY_TREND.FAST_LOWER;
    } else if (before45 > curValSmartMeter.batteryStateOfCharge) {
        return CURRENT_BATTERY_TREND.LOWER;
    }

    return CURRENT_BATTERY_TREND.CONSTANT;
}


export function setMinMaxGlobalOverwrite(min: number, max: number) {
    if (typeof min === "undefined" || min === null || min > overallMaxValue || min < 0) {
        globalRestrictionMin = null;
    } else {
        globalRestrictionMin = min;
    }

    if (typeof max === "undefined" || max === null || max > overallMaxValue || max < 0) {
        globalRestrictionMax = null;
    } else {
        globalRestrictionMax = max;
    }
}

export function setModeGlobalOverwrite(mode: string) {
    if (typeof mode === "undefined" || mode === "" || mode === null) {
        globalRestrictionMode = null;
    } else {
        if (mode !== CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH && mode !== CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW && mode !== CURRENT_INJECTION_MODE.DYNAMIC_INJECTION) {
            globalRestrictionMode = null;
        } else {
            globalRestrictionMode = mode;
        }
    }
}

function controlInjectionMode(curValSmartMeter: CURRENT_IO_BROKER_VALUES): CURRENT_INJECTION_MODE {
    if (injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH) {
        if (curValSmartMeter.batteryStateOfCharge < 25) {
            //stop - whatever our direction is - we are putting everything in the net, with less than 20% battery state..
            if (batteryTrend === CURRENT_BATTERY_TREND.CONSTANT || batteryTrend === CURRENT_BATTERY_TREND.FAST_LOWER || batteryTrend === CURRENT_BATTERY_TREND.LOWER) {
                return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
            }
            return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
        } else if (curValSmartMeter.batteryStateOfCharge < 95 && solarPowerAverageLastHour < 400) {
            return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
        }

        return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH;
    }

    if (injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW) {
        if (curValSmartMeter.batteryStateOfCharge > 25 && (batteryTrend === CURRENT_BATTERY_TREND.FAST_HIGHER || batteryTrend === CURRENT_BATTERY_TREND.HIGHER)) {
            return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
        }
        return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
    }

    if (injectionMode === CURRENT_INJECTION_MODE.DYNAMIC_INJECTION) {
        if (curValSmartMeter.batteryStateOfCharge < 30) {
            return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
        }
        if (curValSmartMeter.batteryStateOfCharge > 60 && batteryTrend === CURRENT_BATTERY_TREND.FAST_HIGHER && solarPowerAverageLastHour > 1000) {
            return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH;
        }
        if (curValSmartMeter.batteryStateOfCharge > 97) {
            return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH;
        }
        return CURRENT_INJECTION_MODE.DYNAMIC_INJECTION;
    }

    return CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW;
}


function determineCurrentLimits(curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    if (curValSmartMeter.injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_HIGH) {
        let minPower = curValSmartMeter.solarPower < 150 ? 150 : curValSmartMeter.solarPower;

        if (curValSmartMeter.batteryStateOfCharge > 98) {
            minPower = minValueForConstantHighMode;
        }
        return {
            min: minValueForConstantHighMode > minPower ? minPower : minValueForConstantHighMode,
            max: overallMaxValue
        }
    }

    if (curValSmartMeter.injectionMode === CURRENT_INJECTION_MODE.CONSTANT_INJECTION_LOW) {
        if (curValSmartMeter.batteryStateOfCharge > 20) {
            return {
                min: 50,
                max: overallMaxValue
            }
        } else if (curValSmartMeter.batteryStateOfCharge > 15) {
            return {
                min: 50,
                max: 100
            }
        } else if (curValSmartMeter.batteryStateOfCharge > 10) {
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

    if (curValSmartMeter.injectionMode === CURRENT_INJECTION_MODE.DYNAMIC_INJECTION) {
        return {
            min: 100,
            max: overallMaxValue
        }
    }
}

function getNextValidPowerValueFor(val: number) {
    //we are always jumping in 25er steps..
    let adjustedVal = (Math.floor(val / 50) + 1) * 50;
    return adjustedVal;
}