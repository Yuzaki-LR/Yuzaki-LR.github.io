---
kind: individual
category: Individual detailed-design project
title: Multi-Domain Life-Support Power and Control Simulation
shortTitle: Life-Support Power and Control
summary: >-
  An individual Simulink/Simscape design coupling power conversion with
  electrical, water, atmospheric-gas, thermal, mechanical and humidity
  regulation for a future ocean habitat.
role: Designer and modeller of the individually submitted detailed design
methods:
  - MATLAB/Simulink
  - Simscape Electrical
  - Simscape Fluids
  - Closed-loop control
featured: true
order: 2
---
<!-- editor:section id="life-engineering-challenge" kind="standard" hidden="false" -->
## Engineering Challenge
<!-- editor:block id="life-opening-boundary" type="paragraph" hidden="false" -->
Life-support demand cannot be represented credibly as a bank of fixed resistors: pumps, electrolysis, ventilation and thermal management switch with water inventory and cabin conditions. This is an individual detailed design, model and report within the 6-8 people habitat concept.
<!-- editor:section id="life-coupled-architecture" kind="standard" hidden="false" -->
## Coupled System Architecture
<!-- editor:block id="life-domain-coupling" type="paragraph" hidden="false" -->
The model couples electrical, rotational-mechanical, moist-air and thermal, gas-concentration and water-inventory behaviour. A disturbed 690 V three-phase source feeds a DC link and a regulated 180 V life-support bus. The conversion model includes current limiting, a pre-charge path, filtering, DC-link buffering and PWM-controlled buck conversion. Represented loads cover water intake, SWRO desalination, recovery and distribution, oxygen generation, carbon-dioxide removal, HVAC and humidity management; some are equivalent process loads rather than physical devices.
<!-- editor:block id="blockca06a8d1370642c4bf793ff94947dafc" type="image" hidden="false" -->
![Image](./images/overall-591e6b03.png)
Overall Model
<!-- editor:section id="life-control-strategy" kind="standard" hidden="false" -->
## Control Strategy
<!-- editor:block id="life-control-layers" type="paragraph" hidden="false" -->
Supervisory feedback from oxygen, carbon-dioxide, water level, temperature and dew point produces enable signals and setpoints. The lower layer uses feedforward, PI correction, filtering and PWM to regulate the 180 V bus and actuator power. This is model control logic, not a real-time controller claim.
<!-- editor:block id="life-targets" type="paragraph" hidden="false" -->
Documented model targets are water inventory 600–1200 L, desalination about 1200 L/day, oxygen 20.5–21.5%, carbon dioxide near 400 ppm, cabin temperature 15–30 °C and dew point below 12 °C. They are targets, not experimental outcomes.
<!-- editor:block id="block00a75a8f216148d39a5af729a9ca91f5" type="image" hidden="false" -->
![Image](./images/hvac-control-fc34f9dd.png)
HVAC and Humidity Management Control System
<!-- editor:block id="block3765f880ee14457789b15c77fdecca0d" type="image" hidden="false" -->
![Image](./images/o2-control-03334bc2.png)
O2/CO2 Management Control System (a) Simulink/Simscape implementation of the O2/CO2 management control system. (b) CO2 removal system control logic. (c) O2 electrolyser hysteresis control logic.
<!-- editor:block id="block3e053178b0f54fde9468d160f6923bd2" type="image" hidden="false" -->
![Image](./images/180v-ac-pwm-fb6a7d5f.png)
180 V DC Bus Buck Converter Closed-Loop PWM Control System
<!-- editor:block id="blockf144bfcd6448445a8440f35a3686c2eb" type="image" hidden="false" -->
![Image](./images/water-control-478cf5b4.png)
Water Desalination, Distribution, Intake and Recovery Pump Control System
<!-- editor:section id="life-simulation-evidence" kind="standard" hidden="false" -->
## Simulation Evidence
<!-- editor:block id="life-bus-trace" type="paragraph" hidden="false" -->
Under the documented disturbance and load-switching sequence, the simulated 180 V bus remained close to its reference while DC-link voltage and current changed. The reported traces also cover motor speed, gas states, cabin temperature, dew point, water level and PWM signals; no exact ripple, settling-time or universal-stability claim is made.
<!-- editor:block id="life-energy-ratio" type="paragraph" hidden="false" -->
For the documented model configuration, the cumulative simulated input-output energy ratio is approximately 97.6%. This is a cumulative simulated input-output energy ratio, not measured physical-system or converter efficiency. Some average-value converter elements in the model use fixed idealised 100% efficiency settings. Instantaneous ratios can exceed unity when DC-link and buffer capacitors release stored energy; the report does not interpret this as physical efficiency above one.
<!-- editor:section id="life-model-limitations" kind="standard" hidden="false" -->
## Model Limitations and Next Steps
<!-- editor:block id="life-future-fidelity" type="paragraph" hidden="false" -->
The model retains rated-point device models and empirical gains. Higher-fidelity manufacturer maps, detailed SWRO and HVAC process models, thermal ports, ageing, fault modes and experimental validation remain future work; the present evidence does not establish hardware performance or validated digital-twin fidelity.
