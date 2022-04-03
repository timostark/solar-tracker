import axios from "axios";
import { CURRENT_SMART_METER_VALUES } from "./AEConversion";

export interface CURRENT_IO_BROKER_VALUES {
    batteryStateOfCharge: number;
    solarPower: number;
    batteryPower: number;
    dcPower: number;
    overallUsedPower: number;
    currentAvg: number;
    currentCount: number;
    currentDay: number;
    totalKwh: number;
    currentDayWh: number;
}

export async function getIOBrokerValues() : Promise<CURRENT_IO_BROKER_VALUES> {
    let values = ["modbus.0.inputRegisters.226.789_Solar_Charger Power", //solar power
        "modbus.0.inputRegisters.100.843_Battery_State of Charge", //% available
        "modbus.0.inputRegisters.225.261_Battery_Current", //battery current
        "modbus.0.inputRegisters.225.259_Battery_voltage", //battery voltage
        "modbus.0.inputRegisters.100.860_DC_System Power", //additional dc output
        "smartmeter.0.1-0:16_7_0__255.value", //overall usage in the house,
        "0_userdata.0.internal.ae_internal_measure_day", //current measure day
        "0_userdata.0.internal.ae_internal_measure_used_avg", //current measure day
        "0_userdata.0.internal.ae_internal_measure_count", //current count
        "0_userdata.0.internal.ae_internal_total_kwh",  //total kwh incl. last day
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
    const currentAvg = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_measure_used_avg")?.val || 0.0;
    const currentCount = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_measure_count")?.val || 0;
    const totalKwh = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_total_kwh")?.val || 0;
    const currentDayWh = resp.find((e: any) => e.id === "0_userdata.0.house_current_day_used_kwh")?.val || 0;

    return {
        batteryStateOfCharge: batteryStateOfCharge,
        solarPower: solarPower,
        batteryPower: batteryCurrent * batteryVoltage,
        dcPower: additionalDcOutput,
        overallUsedPower: overallUsage,
        currentAvg: currentAvg,
        currentCount: currentCount,
        currentDay: currentDay,
        totalKwh: totalKwh,
        currentDayWh: currentDayWh
    };
}

interface KEY_MAP {
    key: string;
    value: string | number;
}

export async function updateIOBrokerValues(curAEConversionValues: CURRENT_SMART_METER_VALUES, curValSmartMeter: CURRENT_IO_BROKER_VALUES ) {

    let allValues : KEY_MAP[] = [];

    const overAllConsumption = Math.round(curValSmartMeter.overallUsedPower + curAEConversionValues.currentPower);
    const usedPower = Math.round(curAEConversionValues.currentPower > overAllConsumption ? overAllConsumption : curAEConversionValues.currentPower);
    const date = new Date();
    const dateStr = date.toLocaleDateString('en-GB').split('/').reverse().join('');
    if (curValSmartMeter.currentDay.toString() !== dateStr) {
        if (curValSmartMeter.currentCount !== 0) {

        }
        curValSmartMeter.currentAvg = 0;
        curValSmartMeter.currentCount = 0;

        //update current 
        curValSmartMeter.totalKwh = curValSmartMeter.totalKwh + curValSmartMeter.currentDayWh / 1000;
        allValues.push({ key: "0_userdata.0.ae_internal_measure_day", value: dateStr });
    }
    curValSmartMeter.currentAvg = ((curValSmartMeter.currentAvg * curValSmartMeter.currentCount) + usedPower) / (curValSmartMeter.currentCount + 1);
    curValSmartMeter.currentCount += 1;
    const injectionKwH = Math.round(curValSmartMeter.currentAvg * date.getHours()) + (curValSmartMeter.currentAvg * date.getMinutes() / 60, 0);
    const totalKwhTotal = injectionKwH / 1000 + curValSmartMeter.totalKwh;


    allValues.push({ key: "0_userdata.0.ae_conversion_0_power", value: curAEConversionValues.currentPower});
    allValues.push({ key: "0_userdata.0.ae_conversion_0_limit", value: curAEConversionValues.currentReduce});
    allValues.push({ key: "0_userdata.0.ae_conversion_0_efficency", value: curAEConversionValues.currentEfficiency * 100});
    allValues.push({ key: "0_userdata.0.victron_battery_power", value: curValSmartMeter.batteryPower});
    allValues.push({ key: "0_userdata.0.house_consumption_bigger_zero", value: curValSmartMeter.overallUsedPower > 0 ? curValSmartMeter.overallUsedPower : 0});
    allValues.push({ key: "0_userdata.0.house_real_consumption", value: overAllConsumption});
    allValues.push({ key: "0_userdata.0.house_used_consumption", value: usedPower});
    allValues.push({ key: "0_userdata.0.ae_internal_measure_used_avg", value: curValSmartMeter.currentAvg});
    allValues.push({ key: "0_userdata.0.ae_internal_measure_count", value: curValSmartMeter.currentCount});
    allValues.push({ key: "0_userdata.0.house_current_day_used_kwh", value: injectionKwH});
    allValues.push({ key: "0_userdata.0.house_total_savings", value: totalKwhTotal * 0.33});
    allValues.push({ key: "0_userdata.0.house_total_used_kwh", value: totalKwhTotal});

    await axios.get(`http://192.168.178.81:8087/setBulk?${ allValues.map((e) => `${e.key}=${e.value}`).join("&") }`);
}