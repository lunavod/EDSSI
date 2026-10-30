cmake_minimum_required(VERSION 3.20)
project(edssi_openxr_probe CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# One self-contained DLL: nothing of the CRT to find in whichever game loads it.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
# Straight into out/openxr-probe-layer, where register.ps1 points the registry; the generator
# expression keeps Visual Studio from adding a Release/ folder of its own.
set(OUTPUT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../out/openxr-probe-layer)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY $<1:${OUTPUT_DIR}>)

add_library(edssi_openxr_probe SHARED layer.cpp)
target_include_directories(edssi_openxr_probe PRIVATE ../openxr-layer/include)
target_compile_definitions(edssi_openxr_probe PRIVATE XR_NO_PROTOTYPES)
target_link_libraries(edssi_openxr_probe PRIVATE dxgi)

add_executable(probe-client client.cpp)
target_include_directories(probe-client PRIVATE ../openxr-layer/include)
target_compile_definitions(probe-client PRIVATE XR_NO_PROTOTYPES)

# The manifest's library_path is relative to the manifest, so the two stay side by side.
add_custom_command(TARGET edssi_openxr_probe POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_SOURCE_DIR}/edssi_openxr_probe.json
          $<TARGET_FILE_DIR:edssi_openxr_probe>/edssi_openxr_probe.json)
