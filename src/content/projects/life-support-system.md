---
title: "Life-Support System – Power and Control Simulation"
shortTitle: "Life-Support Power and Control"
summary: "Individual multi-domain design and simulation of a 180 V DC power and control system for a future ocean-habitat life-support system."
type: "Individual design"
role: "Individual detailed design and simulation"
tools:
  - "MATLAB Simulink"
  - "Simscape"
  - "Closed-loop control"
order: 2
featured: true
overview:
  - >-
    This individual detailed-design project modelled the electrical supply and supervisory control of a future ocean-habitat life-support system. The model connected electrical conversion to water, gas, mechanical, thermal, and humidity-control loads.
contributions:
  - "Developed the individual Simulink/Simscape model and report."
  - "Modelled the 180 V DC bus, converter behaviour, subsystem loads, protection, and efficiency measurement."
  - "Designed the hierarchical control relationships for water processing, oxygen generation, carbon-dioxide removal, HVAC, and humidity management."
technicalApproach:
  - >-
    The design used a 180 V DC bus with PI and PWM converter control, demand-based source-load matching, inrush-current limiting, pre-charge paths, and DC-link buffering.
  - >-
    Life-support demand was represented across water intake, reverse osmosis, recovery and distribution, oxygen generation, carbon-dioxide removal, HVAC, and dew-point or humidity control. Supervisory logic enabled loads in response to process variables rather than operating every load continuously.
results:
  - >-
    Under the documented model configuration, the submitted simulation reports a cumulative efficiency of 97.7%. This is a simulation result and is not presented as measured physical-system efficiency.
  - >-
    Instantaneous input-output power ratios were affected by energy release from DC-link and buffer capacitors, so cumulative energy efficiency was used as the more meaningful system-level measure.
evidence:
  - src: "/assets/projects/life-support-hvac-control.png"
    alt: "Simulink model showing HVAC and humidity-management control subsystems coupled to the life-support electrical load."
    caption: "HVAC and humidity-management section of the individual multi-domain control model."
  - src: "/assets/projects/life-support-efficiency.png"
    alt: "Cumulative energy-efficiency simulation curve rising and settling at approximately 97.7 percent."
    caption: "Cumulative energy-efficiency result for the documented simulation configuration."
reflection:
  - >-
    The model demonstrated why power-electronic control and physical-process control must be evaluated together. A future extension would add component calibration from hardware data and uncertainty analysis around process demand and conversion losses.
---
