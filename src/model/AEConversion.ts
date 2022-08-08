import axios from "axios";

export interface CURRENT_SMART_METER_VALUES {
    currentPower?: number;
    currentReduce?: number;
    currentEfficiency?: number;
}

export async function getAEConversionData(): Promise<CURRENT_SMART_METER_VALUES> {
    const response = await axios.get('http://192.168.178.80:3038/?CMD=CURRENT&DEV=ALL');

    const allInverterData = response.data;
    const inverter0DataSum = allInverterData.data.find((e) => e.ID == 0);
    const inverter1DataSum = allInverterData.data.find((e) => e.ID == 1);

    let ret: CURRENT_SMART_METER_VALUES = {
        currentPower: parseInt(inverter0DataSum?.reduce) || 0,
        currentEfficiency: parseFloat(inverter0DataSum?.percent) || 0,
        currentReduce: parseInt(inverter1DataSum?.reduce) || 0,
    };

    return ret;
}

export async function reduceAEConversion(newVal: number) {
    if (newVal > 1000 || newVal < 0) {
        return;
    }

    let newValDivided = Math.round(newVal / 2);

    await axios.get(`http://192.168.178.80:3038/?CMD=REDUCE&DEV=0&VAL=${newValDivided}`);
    await axios.get(`http://192.168.178.80:3038/?CMD=REDUCE&DEV=1&VAL=${newValDivided}`);
}