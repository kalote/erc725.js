/*
    This file is part of ERC725.js.
    ERC725.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    ERC725.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.
    You should have received a copy of the GNU Lesser General Public License
    along with web3.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file lib/utils.js
 * @author Robert McLeod <@robertdavid010>, Fabian Vogelsteller <fabian@lukso.network>
 * @date 2020
 */

import Web3Utils from 'web3-utils'
import { encoder, valueContentEncodingMap as valueContentMap } from './encoder.js'

export const utils = {

    decodeAllData: (schema, allRawData) => {

        // Requires allRawData to be in an array of key/value pairs: {key:'0x908vsd98...',value:'0x9fuuh...'}
        const results = {}
        // console.log('we are trying to decode all results...')
        // console.log(allRawData)

        // Loop throuch schema when provided all ERC725 keys from blockchain source of truth
        for (let index = 0; index < schema.length; index++) {

            const schemaElement = schema[index]
            let newSchemaElement
            results[schemaElement.name] = null // ensure empty field per schema element


            // Looping through data
            for (let i = 0; i < allRawData.length; i++) {

                const dataElement = allRawData[i] // TODO: Call a change to 'shift()' on data array to avoid more looping
                // console.log('data element...')
                // console.log(dataElement.value)
                if (dataElement.value === '0x') {

                    // console.log('skip decoding...')
                    break

                }

                // MODIFY SCHEMA if we have keyType of array
                if (schemaElement.keyType.toLowerCase() === 'array') {

                    // Create appropriate schema element based on keyType and data element
                    // Set the assumed array elementKey based on potential match with data key
                    const elementKey = schemaElement.key.substr(0, 34) + Web3Utils.leftPad(dataElement.key.substr(dataElement.key.length - 32), 32).replace('0x', '')

                    let newElementValueContent
                    try {

                        // TODO: QUESTION: what about an array of uints
                        Web3Utils.hexToNumber(dataElement.value) // this will be uint if is type array
                        newElementValueContent = schemaElement.valueContent // therefore we will use the 'top' schema

                    } catch (error) {

                        newElementValueContent = schemaElement.elementValueContent // otherwise we assume its no...

                    }
                    newSchemaElement = {
                        key: elementKey,
                        keyType: 'Singleton',
                        valueContent: newElementValueContent, // value content on first element in the array is
                        valueType: schemaElement.elementValueType
                    }

                } else {

                    // Its not an array, so add the single element
                    newSchemaElement = schemaElement

                }

                // CHECK FOR MATCH, we can't be sure data not in the schema is included
                if (dataElement.key === newSchemaElement.key) {

                    const decodedElement = utils.decodeKeyValue(newSchemaElement, dataElement.value) // this will fail being writting to results below becuase it is a number

                    if (schemaElement.keyType.toLowerCase() === 'array') {

                        // Handle arrays for original schemaElement (loop), since a match could also be an array length

                        try {

                            // This will fail when anything BUT the arrayLength key, and fail silently
                            // since we don't need array length key-value in the final decoded results
                            Web3Utils.hexToNumber(dataElement.value)

                        } catch (error) {

                            // Check if there is already an array at the results index
                            if (Array.isArray(results[schemaElement.name])) {

                                // If so, add to the existing results element array
                                results[schemaElement.name].push(decodedElement)

                            } else {

                                // Otherwise reate the new results element array
                                const obj = {}
                                obj[schemaElement.name] = [decodedElement]
                                results[schemaElement.name] = [decodedElement]

                            }

                        }

                    } else {

                        // Handle singleton decoded result
                        results[newSchemaElement.name] = decodedElement

                    }

                } // end CHECK FOR MATCH

                // null results/nothing happens with no match

            } // end forEach data element

        } // end forEach schema element

        return results

    },

    encodeAllData: (schema, data) => {

        // Data must come as key/value pairs, where keys are defined as per the schema
        // 1. Define results array, and loop through data by keys in the object
        const results = [] // results will be the flattened array of key/value pairs able to be deployed using ABI
        // NOTE: This requires properly formatted input data as per the schema (as expected from dedoce)

        // eslint-disable-next-line no-restricted-syntax
        for (let index = 0; index < Object.keys(data).length; index++) {

            const key = Object.keys(data)[index]
            const dataElement = data[key]
            // 2. Find schema for this data data
            // NOTE: Each element should have an object with a single key, with that key being the schema field name
            const schemaElement = schema.find(e => e.name === key)

            // 2.1 test to see if matching with an array '[]' key
            // Better to just test for schemaElement keyType 'Array'?
            if (schemaElement.keyType.toLowerCase() === 'array') {

                // Create the 'sub' schema for array elements
                const newSchemaElement = utils.transposeArraySchema(schemaElement, index)

                // 3.a Loop through the array of data results
                for (let i = 0; i < dataElement.length; i++) {

                    const e = dataElement[i]

                    if (i === 0) {

                        // This is the array length key/value pair
                        results.push({
                            key: schemaElement.key,
                            value: Web3Utils.padLeft(Web3Utils.numberToHex(dataElement.length), 64)
                        })

                    }

                    results.push({
                        key: utils.encodeArrayKey(schemaElement.key, i),
                        value: utils.encodeKeyValue(newSchemaElement, e)
                    })

                }

            } else {

                // 3.b This is a singleton instance
                results.push({
                    key: schemaElement.key,
                    value: utils.encodeKeyValue(schemaElement, dataElement)
                })

            }

        }

        return results

    },

    decodeKeyValue: (schemaElementDefinition, value) => {

        // Check for the missing map.
        if (!valueContentMap[schemaElementDefinition.valueContent] && schemaElementDefinition.valueContent.substr(0, 2) !== '0x') {

            throw new Error('The valueContent for "' + schemaElementDefinition.name + '" is not supported.')

        }

        let sameEncoding = (valueContentMap[schemaElementDefinition.valueContent] && valueContentMap[schemaElementDefinition.valueContent].type === schemaElementDefinition.valueType.split('[]')[0])
        const isArray = (schemaElementDefinition.valueType.substr(schemaElementDefinition.valueType.length - 2) === '[]')

        // VALUE TYPE
        if (
            schemaElementDefinition.valueType !== 'bytes' // we ignore becuase all is decoded by bytes to start with (abi)
        && schemaElementDefinition.valueType !== 'string'
        && !Web3Utils.isAddress(value) // checks for addresses, since technically an address is bytes?
        ) {

            // eslint-disable-next-line no-param-reassign
            value = encoder.decodeValueType(schemaElementDefinition.valueType, value)

        }

        // As per exception above, if address and sameEncoding, then the address still needs to be handled
        if (sameEncoding && Web3Utils.isAddress(value) && !Web3Utils.checkAddressChecksum(value)) {

            sameEncoding = !sameEncoding

        }

        if (sameEncoding && schemaElementDefinition.valueType !== 'string') {

            return value

        }

        // VALUE CONTENT
        // We are finished if duplicated encoding methods

        if (isArray && Array.isArray(value)) {

            // value must be an array also
            const results = []
            for (let index = 0; index < value.length; index++) {

                const element = value[index]
                results.push(encoder.decodeValueContent(schemaElementDefinition.valueContent, element))

            }

            return results

        }

        return encoder.decodeValueContent(schemaElementDefinition.valueContent, value)


    },

    encodeKeyValue: (schemaElementDefinition, value) => {

        // Check for the missing map.
        if (!valueContentMap[schemaElementDefinition.valueContent] && schemaElementDefinition.valueContent.substr(0, 2) !== '0x') {

            throw new Error('The valueContent for "' + schemaElementDefinition.name + '" is not supported.')

        }

        // @param value: can contain single value, or obj as required by spec
        let result
        const isArray = (schemaElementDefinition.valueType.substr(schemaElementDefinition.valueType.length - 2) === '[]')

        const sameEncoding = (valueContentMap[schemaElementDefinition.valueContent] && valueContentMap[schemaElementDefinition.valueContent].type === schemaElementDefinition.valueType.split('[]')[0])

        // We only loop if the valueType done by abi.encodeParameter can not handle it directly
        if (Array.isArray(value) && !sameEncoding) { // value type encoding will handle it?

            // we handle an array element encoding
            const results = []
            for (let index = 0; index < value.length; index++) {

                const element = value[index]
                results.push(encoder.encodeValueContent(schemaElementDefinition.valueContent, element))

            }
            result = results

        } else if (!isArray) {

            // Straight forward encode
            result = encoder.encodeValueContent(schemaElementDefinition.valueContent, value)

        } else if (sameEncoding) {

            result = value // leaving this for below

        }

        if (
        // and we only skip bytes regardless
            schemaElementDefinition.valueType !== 'bytes'
            // Requires encoding because !sameEncoding means both encodings are required
        && !sameEncoding
        ) {

            result = encoder.encodeValueType(schemaElementDefinition.valueType, result)

        } else if (isArray && sameEncoding) {

            result = encoder.encodeValueType(schemaElementDefinition.valueType, result)

        }

        return result

    },

    encodeKeyName: name => {

        const colon = name.indexOf(':')
        return (colon !== -1)
            // if name:subname, then construct using bytes16(hashFirstWord) + bytes12(0) + bytes4(hashLastWord)
            ? Web3Utils.keccak256(name.substr(0, colon)).substr(0, 34)
              + Web3Utils.leftPad(Web3Utils.keccak256(name.substr(colon + 1)).substr(2, 8), 32)
            // otherwise just bytes32(hash)
            : Web3Utils.keccak256(name)

    },

    // eslint-disable-next-line arrow-body-style
    encodeArrayKey: (key, index) => {

        return key.substr(0, 34) + Web3Utils.padLeft(Web3Utils.numberToHex(index), 32).replace('0x', '')

    },

    // eslint-disable-next-line arrow-body-style
    transposeArraySchema: (schema, index) => {

        return {
            key: utils.encodeArrayKey(schema.key, index),
            keyType: 'Singleton',
            valueContent: schema.elementValueContent,
            valueType: schema.elementValueType
        }

    }

}
