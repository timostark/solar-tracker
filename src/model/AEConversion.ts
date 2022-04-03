import axios from "axios";

export interface CURRENT_SMART_METER_VALUES {
    currentPower: number;
    currentReduce: number;
    currentEfficiency: number;
}

export async function getAEConversionData() : Promise<CURRENT_SMART_METER_VALUES> {
    const response = await axios.get('http://192.168.178.80:3038/?CMD=CURRENT&DEV=ALL' );

    const allInverterData = response.data;
    const inverterDataSum = allInverterData.data.find((e) => e.ID == 0);

    return {
        currentPower: parseInt( inverterDataSum?.current ) || 0,
        currentReduce: parseInt( inverterDataSum?.reduce ) || 0,
        currentEfficiency: parseInt( inverterDataSum?.percent ) || 0
    };
}

export async function reduceAEConversion(inverter: number, newVal: number) {
    if(newVal > 500 || newVal < 0 ) {
        return;
    }
    if(inverter !== 0 ) {
        return;
    }

    const response = await axios.get(`http://192.168.178.80:3038/?CMD=REDUCE&DEV=${inverter}&VAL=${newVal}` );
}