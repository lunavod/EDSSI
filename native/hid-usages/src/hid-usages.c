/*
 * Asks Windows what a stick's controls are, instead of guessing at its bytes.
 *
 * EDSSI used to learn a button by watching which bit turned on, and an axis by watching which byte
 * swept. That works without knowing anything about a device, but it is guesswork: it cannot tell an
 * axis from a slider, cannot know a control's real range until it has been swept, and leaves
 * bindings written as "byte 3, bit 2", which mean nothing on anyone else's stick.
 *
 * None of that is necessary on Windows. The HID driver has already parsed the report descriptor,
 * and hands the result over as "preparsed data": HidP_GetValueCaps says which usages a device has
 * and what each one's range is, and HidP_GetUsageValue pulls a named usage straight out of a raw
 * report. So a binding can be "the X axis on this stick", which is portable and honest.
 *
 * This only decodes. node-hid keeps doing the reading, and HID devices open shared on Windows, so
 * the second handle opened here costs nothing and disturbs nothing.
 */

#include <windows.h>

#include <stdio.h>
#include <stdlib.h>

#include <hidsdi.h>
#include <hidpi.h>
#include <node_api.h>

#define MAX_USAGES 256

typedef struct {
  PHIDP_PREPARSED_DATA preparsed;
  HANDLE file;
  HIDP_CAPS caps;
} Device;

static void throw_last_error(napi_env env, const char *what) {
  char message[256];
  snprintf(message, sizeof(message), "%s failed (win32 error %lu)", what, GetLastError());
  napi_throw_error(env, NULL, message);
}

/* Closing the handle and letting the parsed data go, whenever the JS object is collected. */
static void finalize_device(napi_env env, void *data, void *hint) {
  Device *device = (Device *)data;
  (void)env;
  (void)hint;
  if (device == NULL) return;
  if (device->preparsed != NULL) HidD_FreePreparsedData(device->preparsed);
  if (device->file != INVALID_HANDLE_VALUE) CloseHandle(device->file);
  free(device);
}

static napi_value set_int(napi_env env, napi_value object, const char *name, int64_t value) {
  napi_value number;
  napi_create_int64(env, value, &number);
  napi_set_named_property(env, object, name, number);
  return object;
}

static napi_value set_bool(napi_env env, napi_value object, const char *name, bool value) {
  napi_value flag;
  napi_get_boolean(env, value, &flag);
  napi_set_named_property(env, object, name, flag);
  return object;
}

/* Every value control the device reports: the axes, the hats, the sliders and the throttles. */
static napi_value describe_values(napi_env env, Device *device) {
  napi_value list;
  USHORT count = device->caps.NumberInputValueCaps;
  napi_create_array_with_length(env, count, &list);
  if (count == 0) return list;

  HIDP_VALUE_CAPS *caps = calloc(count, sizeof(HIDP_VALUE_CAPS));
  if (caps == NULL) return list;
  if (HidP_GetValueCaps(HidP_Input, caps, &count, device->preparsed) != HIDP_STATUS_SUCCESS) {
    free(caps);
    return list;
  }

  for (USHORT i = 0; i < count; i++) {
    HIDP_VALUE_CAPS *cap = &caps[i];
    napi_value entry;
    napi_create_object(env, &entry);
    set_int(env, entry, "usagePage", cap->UsagePage);
    /* A ranged cap covers several usages at once; the first is the one worth naming. */
    set_int(env, entry, "usage", cap->IsRange ? cap->Range.UsageMin : cap->NotRange.Usage);
    set_int(env, entry, "reportId", cap->ReportID);
    set_int(env, entry, "linkCollection", cap->LinkCollection);
    set_int(env, entry, "logicalMin", cap->LogicalMin);
    set_int(env, entry, "logicalMax", cap->LogicalMax);
    set_int(env, entry, "bitSize", cap->BitSize);
    /* A hat says "centred" with a value outside its range rather than with a number. */
    set_bool(env, entry, "hasNull", cap->HasNull != 0);
    napi_set_element(env, list, i, entry);
  }

  free(caps);
  return list;
}

/* Every button, as the ranges of usages they occupy. */
static napi_value describe_buttons(napi_env env, Device *device) {
  napi_value list;
  USHORT count = device->caps.NumberInputButtonCaps;
  napi_create_array_with_length(env, count, &list);
  if (count == 0) return list;

  HIDP_BUTTON_CAPS *caps = calloc(count, sizeof(HIDP_BUTTON_CAPS));
  if (caps == NULL) return list;
  if (HidP_GetButtonCaps(HidP_Input, caps, &count, device->preparsed) != HIDP_STATUS_SUCCESS) {
    free(caps);
    return list;
  }

  for (USHORT i = 0; i < count; i++) {
    HIDP_BUTTON_CAPS *cap = &caps[i];
    napi_value entry;
    napi_create_object(env, &entry);
    set_int(env, entry, "usagePage", cap->UsagePage);
    set_int(env, entry, "usageMin", cap->IsRange ? cap->Range.UsageMin : cap->NotRange.Usage);
    set_int(env, entry, "usageMax", cap->IsRange ? cap->Range.UsageMax : cap->NotRange.Usage);
    set_int(env, entry, "reportId", cap->ReportID);
    set_int(env, entry, "linkCollection", cap->LinkCollection);
    napi_set_element(env, list, i, entry);
  }

  free(caps);
  return list;
}

/*
 * open(path) -> { device, reportLength, usage, usagePage, values: [...], buttons: [...] }
 *
 * The handle asks for no access at all: metadata and preparsed data need none, and asking for read
 * would risk being refused while the game holds the stick.
 */
static napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "open(path) needs a device path");
    return NULL;
  }

  size_t length = 0;
  napi_get_value_string_utf8(env, argv[0], NULL, 0, &length);
  char *path = malloc(length + 1);
  if (path == NULL) return NULL;
  napi_get_value_string_utf8(env, argv[0], path, length + 1, &length);

  HANDLE file = CreateFileA(
      path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
  free(path);
  if (file == INVALID_HANDLE_VALUE) {
    throw_last_error(env, "CreateFile");
    return NULL;
  }

  Device *device = calloc(1, sizeof(Device));
  if (device == NULL) {
    CloseHandle(file);
    return NULL;
  }
  device->file = file;

  if (!HidD_GetPreparsedData(file, &device->preparsed)) {
    finalize_device(env, device, NULL);
    throw_last_error(env, "HidD_GetPreparsedData");
    return NULL;
  }
  if (HidP_GetCaps(device->preparsed, &device->caps) != HIDP_STATUS_SUCCESS) {
    finalize_device(env, device, NULL);
    napi_throw_error(env, NULL, "HidP_GetCaps failed");
    return NULL;
  }

  napi_value result;
  napi_create_object(env, &result);
  napi_value external;
  napi_create_external(env, device, finalize_device, NULL, &external);
  napi_set_named_property(env, result, "device", external);
  set_int(env, result, "reportLength", device->caps.InputReportByteLength);
  set_int(env, result, "usage", device->caps.Usage);
  set_int(env, result, "usagePage", device->caps.UsagePage);
  napi_set_named_property(env, result, "values", describe_values(env, device));
  napi_set_named_property(env, result, "buttons", describe_buttons(env, device));
  return result;
}

/*
 * decode(device, report) -> { values: [{usagePage, usage, value}], buttons: [{usagePage, usage}] }
 *
 * The report is passed exactly as the device sent it, report id included, which is what node-hid
 * hands over and what HidP expects.
 */
static napi_value Decode(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) {
    napi_throw_type_error(env, NULL, "decode(device, report) needs both");
    return NULL;
  }

  Device *device = NULL;
  napi_get_value_external(env, argv[0], (void **)&device);
  if (device == NULL) {
    napi_throw_type_error(env, NULL, "decode() was not given an open device");
    return NULL;
  }

  void *report = NULL;
  size_t reportLength = 0;
  if (napi_get_buffer_info(env, argv[1], &report, &reportLength) != napi_ok) {
    napi_throw_type_error(env, NULL, "decode() needs the report as a Buffer");
    return NULL;
  }

  napi_value result;
  napi_create_object(env, &result);

  /* Values: ask for each one this device said it had. */
  napi_value values;
  napi_create_array(env, &values);
  USHORT valueCount = device->caps.NumberInputValueCaps;
  if (valueCount > 0) {
    HIDP_VALUE_CAPS *caps = calloc(valueCount, sizeof(HIDP_VALUE_CAPS));
    if (caps != NULL &&
        HidP_GetValueCaps(HidP_Input, caps, &valueCount, device->preparsed) ==
            HIDP_STATUS_SUCCESS) {
      uint32_t written = 0;
      for (USHORT i = 0; i < valueCount; i++) {
        HIDP_VALUE_CAPS *cap = &caps[i];
        USAGE usage = cap->IsRange ? cap->Range.UsageMin : cap->NotRange.Usage;
        ULONG value = 0;
        /* A control belonging to another report id simply isn't in this report; that is normal. */
        if (HidP_GetUsageValue(HidP_Input, cap->UsagePage, cap->LinkCollection, usage, &value,
                               device->preparsed, (PCHAR)report,
                               (ULONG)reportLength) != HIDP_STATUS_SUCCESS) {
          continue;
        }

        napi_value entry;
        napi_create_object(env, &entry);
        set_int(env, entry, "usagePage", cap->UsagePage);
        set_int(env, entry, "usage", usage);
        set_int(env, entry, "value", (int64_t)value);
        napi_set_element(env, values, written++, entry);
      }
    }
    free(caps);
  }
  napi_set_named_property(env, result, "values", values);

  /* Buttons: whichever usages are down right now, per usage page. */
  napi_value buttons;
  napi_create_array(env, &buttons);
  USHORT buttonCount = device->caps.NumberInputButtonCaps;
  if (buttonCount > 0) {
    HIDP_BUTTON_CAPS *caps = calloc(buttonCount, sizeof(HIDP_BUTTON_CAPS));
    if (caps != NULL &&
        HidP_GetButtonCaps(HidP_Input, caps, &buttonCount, device->preparsed) ==
            HIDP_STATUS_SUCCESS) {
      uint32_t written = 0;
      USAGE down[MAX_USAGES];
      for (USHORT i = 0; i < buttonCount; i++) {
        ULONG length = MAX_USAGES;
        if (HidP_GetUsages(HidP_Input, caps[i].UsagePage, caps[i].LinkCollection, down, &length,
                           device->preparsed, (PCHAR)report,
                           (ULONG)reportLength) != HIDP_STATUS_SUCCESS) {
          continue;
        }

        for (ULONG u = 0; u < length; u++) {
          napi_value entry;
          napi_create_object(env, &entry);
          set_int(env, entry, "usagePage", caps[i].UsagePage);
          set_int(env, entry, "usage", down[u]);
          napi_set_element(env, buttons, written++, entry);
        }
      }
    }
    free(caps);
  }
  napi_set_named_property(env, result, "buttons", buttons);

  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value open_fn, decode_fn;
  napi_create_function(env, "open", NAPI_AUTO_LENGTH, Open, NULL, &open_fn);
  napi_create_function(env, "decode", NAPI_AUTO_LENGTH, Decode, NULL, &decode_fn);
  napi_set_named_property(env, exports, "open", open_fn);
  napi_set_named_property(env, exports, "decode", decode_fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
