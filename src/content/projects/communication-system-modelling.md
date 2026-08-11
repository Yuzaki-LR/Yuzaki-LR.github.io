---
title: "Communication-System Modelling and Filter Optimisation"
shortTitle: "Communication-System Modelling"
summary: "Individual MATLAB investigation of channel capacity, SNR, AWGN demodulation, and filter performance using BER and MSE."
type: "Individual laboratory"
role: "Individual modelling, implementation, and analysis"
tools:
  - "MATLAB"
  - "Signal processing"
  - "BER and MSE analysis"
order: 3
featured: true
overview:
  - >-
    This individual laboratory project investigated communication-channel behaviour and coherent OOK/AM demodulation under additive white Gaussian noise. The work combined analytical relationships with reproducible MATLAB simulation.
contributions:
  - "Implemented the channel-capacity, BER, SNR-distance, demodulation, parameter-search, and filter-comparison analysis in MATLAB."
  - "Used a fixed random seed and consistent noise conditions for comparative testing."
  - "Used BER as the primary selection metric and MSE as the tie-breaker."
technicalApproach:
  - >-
    The first analysis examined Shannon capacity and BER under bandwidth and temperature variation, followed by SNR degradation with distance at 2 dB/km attenuation.
  - >-
    The demodulation study compared moving-median, FFT, Butterworth, and Chebyshev filters after parameter sweeps across the same noise-power conditions.
results:
  - >-
    Among the tested filters and parameter ranges, the Butterworth configuration achieved the lowest reported average BER of 0.0593 and the lowest reported MSE of 4.04 × 10^-2.
  - >-
    The result is limited to the simulated signal, noise conditions, parameter ranges, and evaluation method documented in the laboratory work.
evidence:
  - src: "/assets/projects/communication-channel-capacity.png"
    alt: "Shannon channel-capacity curves plotted against temperature for three different bandwidth scenarios."
    caption: "Channel capacity versus temperature under decreased, nominal, and increased bandwidth scenarios."
  - src: "/assets/projects/communication-filter-results.png"
    alt: "Table comparing average BER and MSE for moving-median, FFT, Butterworth, and Chebyshev filters."
    caption: "Optimised filter comparison showing the reported average BER and MSE values."
reflection:
  - >-
    The exercise reinforced the need to compare filters with consistent data, parameter searches, and evaluation metrics. A stronger future study would use independent validation signals and confidence intervals across repeated noise realisations.
---
