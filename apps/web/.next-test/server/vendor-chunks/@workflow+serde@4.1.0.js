"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@workflow+serde@4.1.0";
exports.ids = ["vendor-chunks/@workflow+serde@4.1.0"];
exports.modules = {

/***/ "(ssr)/../../node_modules/.pnpm/@workflow+serde@4.1.0/node_modules/@workflow/serde/dist/index.js":
/*!*************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@workflow+serde@4.1.0/node_modules/@workflow/serde/dist/index.js ***!
  \*************************************************************************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   WORKFLOW_DESERIALIZE: () => (/* binding */ WORKFLOW_DESERIALIZE),\n/* harmony export */   WORKFLOW_SERIALIZE: () => (/* binding */ WORKFLOW_SERIALIZE)\n/* harmony export */ });\n/**\n * Symbol used to define custom serialization for user-defined class instances.\n * The static method should accept an instance and return serializable data.\n *\n * @example\n * ```ts\n * import { WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE } from '@workflow/serde';\n *\n * class MyClass {\n *   constructor(public value: string) {}\n *\n *   static [WORKFLOW_SERIALIZE](instance: MyClass) {\n *     return { value: instance.value };\n *   }\n *\n *   static [WORKFLOW_DESERIALIZE](data: { value: string }) {\n *     return new MyClass(data.value);\n *   }\n * }\n * ```\n */\nconst WORKFLOW_SERIALIZE = Symbol.for('workflow-serialize');\n/**\n * Symbol used to define custom deserialization for user-defined class instances.\n * The static method should accept serialized data and return a class instance.\n *\n * @see WORKFLOW_SERIALIZE for usage example\n */\nconst WORKFLOW_DESERIALIZE = Symbol.for('workflow-deserialize');\n//# sourceMappingURL=index.js.map//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHNzcikvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0B3b3JrZmxvdytzZXJkZUA0LjEuMC9ub2RlX21vZHVsZXMvQHdvcmtmbG93L3NlcmRlL2Rpc3QvaW5kZXguanMiLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxZQUFZLDJDQUEyQztBQUN2RDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsZ0JBQWdCO0FBQ2hCO0FBQ0E7QUFDQSwyQ0FBMkMsZUFBZTtBQUMxRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ087QUFDUDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDTztBQUNQIiwic291cmNlcyI6WyIvVXNlcnMvYWxhbnMvRG9jdW1lbnRzL2NvZGUvZm91bmRyeS9ub2RlX21vZHVsZXMvLnBucG0vQHdvcmtmbG93K3NlcmRlQDQuMS4wL25vZGVfbW9kdWxlcy9Ad29ya2Zsb3cvc2VyZGUvZGlzdC9pbmRleC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFN5bWJvbCB1c2VkIHRvIGRlZmluZSBjdXN0b20gc2VyaWFsaXphdGlvbiBmb3IgdXNlci1kZWZpbmVkIGNsYXNzIGluc3RhbmNlcy5cbiAqIFRoZSBzdGF0aWMgbWV0aG9kIHNob3VsZCBhY2NlcHQgYW4gaW5zdGFuY2UgYW5kIHJldHVybiBzZXJpYWxpemFibGUgZGF0YS5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGltcG9ydCB7IFdPUktGTE9XX1NFUklBTElaRSwgV09SS0ZMT1dfREVTRVJJQUxJWkUgfSBmcm9tICdAd29ya2Zsb3cvc2VyZGUnO1xuICpcbiAqIGNsYXNzIE15Q2xhc3Mge1xuICogICBjb25zdHJ1Y3RvcihwdWJsaWMgdmFsdWU6IHN0cmluZykge31cbiAqXG4gKiAgIHN0YXRpYyBbV09SS0ZMT1dfU0VSSUFMSVpFXShpbnN0YW5jZTogTXlDbGFzcykge1xuICogICAgIHJldHVybiB7IHZhbHVlOiBpbnN0YW5jZS52YWx1ZSB9O1xuICogICB9XG4gKlxuICogICBzdGF0aWMgW1dPUktGTE9XX0RFU0VSSUFMSVpFXShkYXRhOiB7IHZhbHVlOiBzdHJpbmcgfSkge1xuICogICAgIHJldHVybiBuZXcgTXlDbGFzcyhkYXRhLnZhbHVlKTtcbiAqICAgfVxuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBXT1JLRkxPV19TRVJJQUxJWkUgPSBTeW1ib2wuZm9yKCd3b3JrZmxvdy1zZXJpYWxpemUnKTtcbi8qKlxuICogU3ltYm9sIHVzZWQgdG8gZGVmaW5lIGN1c3RvbSBkZXNlcmlhbGl6YXRpb24gZm9yIHVzZXItZGVmaW5lZCBjbGFzcyBpbnN0YW5jZXMuXG4gKiBUaGUgc3RhdGljIG1ldGhvZCBzaG91bGQgYWNjZXB0IHNlcmlhbGl6ZWQgZGF0YSBhbmQgcmV0dXJuIGEgY2xhc3MgaW5zdGFuY2UuXG4gKlxuICogQHNlZSBXT1JLRkxPV19TRVJJQUxJWkUgZm9yIHVzYWdlIGV4YW1wbGVcbiAqL1xuZXhwb3J0IGNvbnN0IFdPUktGTE9XX0RFU0VSSUFMSVpFID0gU3ltYm9sLmZvcignd29ya2Zsb3ctZGVzZXJpYWxpemUnKTtcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWluZGV4LmpzLm1hcCJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOlswXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(ssr)/../../node_modules/.pnpm/@workflow+serde@4.1.0/node_modules/@workflow/serde/dist/index.js\n");

/***/ })

};
;