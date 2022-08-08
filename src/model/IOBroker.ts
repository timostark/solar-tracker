import axios from "axios";
import { CURRENT_SMART_METER_VALUES } from "./AEConversion";
import * as fs from 'fs';
import { Buffer } from 'buffer';

export enum CURRENT_BATTERY_TREND {
    FAST_LOWER = "FastLower",
    LOWER = "Lower",
    CONSTANT = "Constant",
    HIGHER = "Higher",
    FAST_HIGHER = "FastHigher"
};

export enum CURRENT_INJECTION_MODE {
    CONSTANT_INJECTION_LOW = "Constant-Low",
    CONSTANT_INJECTION_HIGH = "Constant-High",
    DYNAMIC_INJECTION = "Dynamic"
};

export enum VE_BUS_STATE {
    OFF = 0,
    LOW_POWER = 1,
    FAULT = 2,
    BULK = 3,
    ABSOPRTION = 4,
    FLOAT = 5,
    STOARGE = 6,
    EQUALIZE = 7,
    PASSTHRU = 8,
    INVERTING = 9,
    POWER_ASSIST = 10,
    POWER_SUPPLY = 11,
    BULK_PROTECTION = 252
}

export interface CURRENT_IO_BROKER_VALUES {
    batteryStateOfCharge: number;
    solarPower: number;
    batteryPower: number;
    dcPower: number;
    overallUsedPower: number;
    currentDay: number;
    totalKwh: number;
    currentDayWh: number;
    criticalACLoads: number;
    maxChargeCurrent: number;
    overvoltageFeedIn: number;
    batteryTrend?: CURRENT_BATTERY_TREND;
    injectionMode?: CURRENT_INJECTION_MODE;
    currentPower: number;
    currentEssTarget: number;
    vebusState: VE_BUS_STATE;
}

export async function getIOBrokerValues(): Promise<CURRENT_IO_BROKER_VALUES> {
    let values = ["modbus.0.inputRegisters.226.789_Solar_Charger Power", //solar power
        "modbus.0.inputRegisters.100.843_Battery_State of Charge", //% available
        "modbus.0.inputRegisters.225.261_Battery_Current", //battery current
        "modbus.0.holdingRegisters.227.65_Overvoltage_Feed In",//overvoltage feed in
        "modbus.0.inputRegisters.225.259_Battery_voltage", //battery voltage
        "modbus.0.inputRegisters.100.860_DC_System Power", //additional dc output
        "modbus.0.inputRegisters.100.820_Grid_L1", //input power (= actual values put into grid..)
        "modbus.0.holdingRegisters.227.37_Ess_Setpoint", //target value..
        "modbus.0.inputRegisters.227.31_VE_Bus_state", //veBusState
        "smartmeter.0.1-0:16_7_0__255.value", //overall usage in the house,
        "0_userdata.0.internal.ae_internal_measure_day", //current measure day
        "0_userdata.0.internal.ae_internal_measure_used_avg", //current measure day
        "0_userdata.0.internal.ae_internal_measure_count", //current count
        "0_userdata.0.internal.ae_internal_total_kwh",  //total kwh incl. last day
        "modbus.0.inputRegisters.100.817_AC_Consumption L1", //Critical Loads on AC Out
        "modbus.0.inputRegisters.100.2705_Max_charge current dvcc", //max total solar amperes
    ];
    const response = await axios.get('http://192.168.178.81:8087/getBulk/' + values.join(","));

    let resp = response.data;

    const solarPower = resp.find((e: any) => e.id === "modbus.0.inputRegisters.226.789_Solar_Charger Power")?.val || 0;
    const batteryStateOfCharge = resp.find((e: any) => e.id === "modbus.0.inputRegisters.100.843_Battery_State of Charge")?.val || 0;
    const batteryCurrent = resp.find((e: any) => e.id === "modbus.0.inputRegisters.225.261_Battery_Current")?.val || 0;
    const batteryVoltage = resp.find((e: any) => e.id === "modbus.0.inputRegisters.225.259_Battery_voltage")?.val || 0;
    const additionalDcOutput = resp.find((e: any) => e.id === "modbus.0.inputRegisters.100.860_DC_System Power")?.val || 0;
    const overallUsage = resp.find((e: any) => e.id === "smartmeter.0.1-0:16_7_0__255.value")?.val || 0;
    const currentDay = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_measure_day")?.val || "";
    const totalKwh = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_total_kwh")?.val || 0;
    let currentMultiPlusPower = resp.find((e: any) => e.id === "modbus.0.inputRegisters.100.820_Grid_L1")?.val || 0;
    let currentMultiPlusTarget = resp.find((e: any) => e.id === "modbus.0.holdingRegisters.227.37_Ess_Setpoint")?.val || 0;
    let currentVeBusState = resp.find((e: any) => e.id === "modbus.0.inputRegisters.227.31_VE_Bus_state")?.val || 8;
    let criticalACLoads = resp.find((e: any) => e.id === "modbus.0.inputRegisters.100.817_AC_Consumption L1")?.val || 0;
    let overvoltageFeedIn = resp.find((e: any) => e.id === "modbus.0.holdingRegisters.227.65_Overvoltage_Feed In")?.val || 0;

    if (criticalACLoads < 0) {
        criticalACLoads = criticalACLoads * -1;
    }

    if (currentVeBusState === VE_BUS_STATE.PASSTHRU) {
        currentMultiPlusTarget = 0;
        currentMultiPlusPower = 0;
    }

    const currentDayWh = resp.find((e: any) => e.id === "0_userdata.0.house_current_day_used_kwh")?.val || 0;
    const maxChargeCurrent = resp.find((e: any) => e.id === "modbus.0.inputRegisters.100.2705_Max_charge current dvcc")?.val || 50;

    if (currentMultiPlusPower < 0) {
        currentMultiPlusPower = currentMultiPlusPower * -1;
    }
    if (currentMultiPlusTarget < 0) {
        currentMultiPlusTarget = currentMultiPlusTarget * -1;
    }

    return {
        batteryStateOfCharge: batteryStateOfCharge,
        solarPower: solarPower,
        batteryPower: batteryCurrent * batteryVoltage,
        dcPower: additionalDcOutput,
        overallUsedPower: overallUsage,
        overvoltageFeedIn: overvoltageFeedIn,
        currentDay: currentDay,
        currentPower: currentMultiPlusPower,
        currentEssTarget: currentMultiPlusTarget,
        totalKwh: totalKwh,
        currentDayWh: currentDayWh,
        criticalACLoads: criticalACLoads,
        vebusState: currentVeBusState,
        maxChargeCurrent: maxChargeCurrent
    };
}

interface KEY_MAP {
    key: string;
    value: string | number;
}

let whHistorySize = 0;
let whHistoryTotal: { [hour: number]: { [minute: number]: { used: number, total: number, count: number } } } = {};
let whCurrentMinute = -1;
let whHistorySeconds: { [second: number]: { used: number, total: number } } = {};

export function fillWhHistory(curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    const overAllConsumption = Math.round(curValSmartMeter.overallUsedPower + curValSmartMeter.currentPower);
    const usedPower = Math.round(curValSmartMeter.currentPower > overAllConsumption ? overAllConsumption : curValSmartMeter.currentPower) + Math.round(curValSmartMeter.criticalACLoads);
    const date = new Date();

    whHistorySeconds[date.getSeconds()] = { used: usedPower, total: curValSmartMeter.currentPower + curValSmartMeter.criticalACLoads };

    if (!whHistoryTotal[date.getHours()]) {
        whHistoryTotal[date.getHours()] = {};
    }
    let cur = whHistoryTotal[date.getHours()][date.getMinutes()];
    if (!cur) {
        whHistoryTotal[date.getHours()][date.getMinutes()] = { used: usedPower, total: curValSmartMeter.currentPower + curValSmartMeter.criticalACLoads, count: 1 };
    } else {
        cur.total = Math.round((cur.total * cur.count + curValSmartMeter.currentPower + curValSmartMeter.criticalACLoads) / (cur.count + 1));
        cur.used = Math.round((cur.used * cur.count + usedPower) / (cur.count + 1));
        cur.count = cur.count + 1;
    }

    whHistorySize++;

    if (whHistorySize % 30 === 0) {
        const dateStr = date.toLocaleDateString('en-GB').split('/').reverse().join('');

        fs.writeFile(dateStr + "_total.json", JSON.stringify(whHistoryTotal), (err) => {
            return;
        });
    }
}

export function loadWHHistory() {
    const date = new Date();
    const dateStr = date.toLocaleDateString('en-GB').split('/').reverse().join('');

    try {
        const dataTotal = fs.readFileSync(process.cwd() + "/" + dateStr + "_total.json");
        whHistoryTotal = JSON.parse(dataTotal.toString());
    } catch (err) { }
}


export async function updateIOBrokerValues(curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    let allValues: KEY_MAP[] = [];

    const overAllConsumption = Math.round(curValSmartMeter.overallUsedPower + curValSmartMeter.currentPower + curValSmartMeter.criticalACLoads);
    const usedPower = Math.round(curValSmartMeter.currentPower > overAllConsumption ? overAllConsumption : curValSmartMeter.currentPower) + Math.round(curValSmartMeter.criticalACLoads);
    const date = new Date();

    //get current hour saved on the backend - if our hour changed, we can push our current value foreward (if that makes sense?)
    const dateStr = date.toLocaleDateString('en-GB').split('/').reverse().join('');
    if (curValSmartMeter.currentDay.toString() !== dateStr) {
        whHistoryTotal = {};

        //update current 
        curValSmartMeter.totalKwh = curValSmartMeter.totalKwh + curValSmartMeter.currentDayWh / 1000;
        allValues.push({ key: "0_userdata.0.internal.ae_internal_measure_day", value: dateStr });
        allValues.push({ key: "0_userdata.0.ae_internal_total_kwh", value: curValSmartMeter.totalKwh });
    }

    //calc value per hour..
    let injectionKwH = 0;
    injectionKwH = Math.round(injectionKwH);

    //total injection kwh..
    let injectionKwHTotal = 0;

    const curHour = date.getHours();
    const curMinute = date.getMinutes();
    const curSecond = date.getSeconds();

    Object.getOwnPropertyNames(whHistoryTotal).forEach((hour) => {
        let kwInHour = 0;
        let kwInHourTotal = 0;
        let kwLastMinute = -1;
        const hourInt = parseInt(hour);
        Object.getOwnPropertyNames(whHistoryTotal[hour]).forEach((minuteStr) => {
            const minute = parseInt(minuteStr);

            if (hourInt == curHour && minute == curMinute) {
                let kwhUsed = 0;
                let kwhTotal = 0;
                let lastValueUsed = curValSmartMeter.currentPower + curValSmartMeter.criticalACLoads;
                let lastValueTotal = overAllConsumption;
                for (var j = curSecond; j >= 0; j--) {
                    if (typeof whHistorySeconds[j] !== "undefined") {
                        lastValueUsed = whHistorySeconds[j].used;
                        lastValueTotal = whHistorySeconds[j].total;
                    }
                    kwhUsed += lastValueUsed;
                    kwhTotal += lastValueTotal;
                }

                kwhUsed = kwhUsed / 60;
                kwhTotal = kwhTotal / 60;

                kwInHour = kwInHour + kwhUsed * (minute - kwLastMinute);
                kwInHourTotal = kwInHourTotal + kwhTotal * (minute - kwLastMinute);
            } else {
                kwInHour = kwInHour + whHistoryTotal[hour][minute].used * (minute - kwLastMinute);
                kwInHourTotal = kwInHourTotal + whHistoryTotal[hour][minute].total * (minute - kwLastMinute);
            }
            kwLastMinute = minute;
        });

        injectionKwH += kwInHour / 60;
        injectionKwHTotal += kwInHourTotal / 60;
    });

    const totalKwhTotal = injectionKwH / 1000 + curValSmartMeter.totalKwh;

    allValues.push({ key: "0_userdata.0.battery_trend", value: curValSmartMeter.batteryTrend });
    allValues.push({ key: "0_userdata.0.house_injection_mode", value: curValSmartMeter.injectionMode });
    allValues.push({ key: "0_userdata.0.ae_conversion_0_power", value: curValSmartMeter.currentPower + curValSmartMeter.criticalACLoads });
    allValues.push({ key: "0_userdata.0.ae_conversion_0_limit", value: curValSmartMeter.currentEssTarget });
    allValues.push({ key: "0_userdata.0.victron_battery_power", value: curValSmartMeter.batteryPower });
    allValues.push({ key: "0_userdata.0.house_consumption_bigger_zero", value: curValSmartMeter.overallUsedPower > 0 ? curValSmartMeter.overallUsedPower : 0 });
    allValues.push({ key: "0_userdata.0.house_real_consumption", value: overAllConsumption });
    allValues.push({ key: "0_userdata.0.house_used_consumption", value: usedPower });
    allValues.push({ key: "0_userdata.0.house_current_day_used_kwh", value: injectionKwH });
    allValues.push({ key: "0_userdata.0.house_current_day_injected_kwh", value: injectionKwHTotal });
    allValues.push({ key: "0_userdata.0.house_total_savings", value: totalKwhTotal * 0.33 });
    allValues.push({ key: "0_userdata.0.house_total_used_kwh", value: totalKwhTotal });

    await axios.get(`http://192.168.178.81:8087/setBulk?${allValues.map((e) => `${e.key}=${e.value}`).join("&")}`);
}