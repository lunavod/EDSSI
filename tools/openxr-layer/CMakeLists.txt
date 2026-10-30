cmake_minimum_required(VERSION 3.20)
project(edssi_openxr_layer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Self-contained binaries: nothing of the CRT to find in whichever game loads the layer.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
# Straight into out/openxr-layer, where EDSSI and register.ps1 look; the generator expression
# keeps Visual Studio from adding a Release/ folder of its own.
set(OUTPUT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../out/openxr-layer)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY $<1:${OUTPUT_DIR}>)
add_compile_definitions(XR_NO_PROTOTYPES UNICODE _UNICODE _CRT_SECURE_NO_WARNINGS)
add_compile_options(/W3 /utf-8)

add_library(edssi_openxr_layer SHARED layer.cpp)
target_include_directories(edssi_openxr_layer PRIVATE include)
target_link_libraries(edssi_openxr_layer PRIVATE d3d11 dxgi)

add_executable(edssi-openxr-bridge bridge.cpp)
target_link_libraries(edssi-openxr-bridge PRIVATE d3d11 dxgi)

add_executable(openxr-layer-test test.cpp)
target_include_directories(openxr-layer-test PRIVATE include)
target_link_libraries(openxr-layer-test PRIVATE d3d11 dxgi)

# The manifest's library_path is relative to the manifest, so the two stay side by side.
add_custom_command(TARGET edssi_openxr_layer POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_SOURCE_DIR}/edssi_openxr_layer.json
          $<TARGET_FILE_DIR:edssi_openxr_layer>/edssi_openxr_layer.json)

# Headless runs through the real loader: a runtime with no headset and a stand-in for the game.
add_library(fake_runtime SHARED fake_runtime.cpp)
target_include_directories(fake_runtime PRIVATE include)
target_link_libraries(fake_runtime PRIVATE d3d11)
add_executable(xr-client xr_client.cpp)
target_include_directories(xr-client PRIVATE include)
target_link_libraries(xr-client PRIVATE d3d11)
add_custom_command(TARGET fake_runtime POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_SOURCE_DIR}/fake_runtime.json
          $<TARGET_FILE_DIR:fake_runtime>/fake_runtime.json)
