import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Download, Play, Settings, Activity, Heart, Stethoscope, Wind } from "lucide-react";
import { simulateFpcgDataset, resampleToLength } from "@/lib/fpcg";
import { simulateHeartDataset } from "@/lib/pcg";
import { genNormalLungSignal, genFineCracklesSignal, genCoarseCracklesSignal, genWheezeSignal } from "@/lib/lung";

type DataPoint = { timestamp: number; value: number; type: string; series: number };

const dataTypes = [
  { id: "normal_heart", name: "Normal Heart Sounds", icon: Heart, description: "Standard human cardiac audio", category: "Heart Sound Simulation" },
  { id: "valve_disease", name: "Valve Disease", icon: Activity, description: "Murmur timing, frequency, envelope shape", category: "Heart Sound Simulation" },
  { id: "pericardial_disease", name: "Pericardial Disease", icon: Stethoscope, description: "High-frequency friction or short sounds", category: "Heart Sound Simulation" },
  { id: "congenital_disease", name: "Congenital Disease", icon: Heart, description: "Special splitting patterns, continuous murmurs", category: "Heart Sound Simulation" },
  { id: "heart_failure", name: "Heart Failure/Cardiomyopathy", icon: Activity, description: "S3/S4 gallop rhythm patterns", category: "Heart Sound Simulation" },
  { id: "arrhythmia", name: "Arrhythmia", icon: Activity, description: "RR interval and S1 intensity changes", category: "Heart Sound Simulation" },
  { id: "fhs_normal", name: "Normal Fetal Heart Sounds", icon: Heart, description: "Standard fetal cardiac sounds", category: "Fetal Heart Sounds" },
  { id: "fhs_arrhythmia", name: "Arrhythmia", icon: Activity, description: "Irregular RR intervals", category: "Fetal Heart Sounds" },
  { id: "fhs_move_strong", name: "Strong Movement", icon: Activity, description: "Enhanced movement artifacts", category: "Fetal Heart Sounds" },
  { id: "fhs_move_weak", name: "Weak Movement", icon: Activity, description: "Reduced movement artifacts", category: "Fetal Heart Sounds" },
  { id: "fhs_uc_fast", name: "Fast Contractions", icon: Activity, description: "Frequent uterine contractions", category: "Fetal Heart Sounds" },
  { id: "fhs_uc_slow", name: "Slow Contractions", icon: Activity, description: "Infrequent/longer contractions", category: "Fetal Heart Sounds" },
  { id: "normal_lung", name: "Normal Lung Sounds", icon: Wind, description: "Standard respiratory audio", category: "Lung Sound Simulation" },
  { id: "coarse_crackles", name: "Coarse Crackles", icon: Wind, description: "Low-pitched wet sounds", category: "Lung Sound Simulation" },
  { id: "fine_crackles", name: "Fine Crackles", icon: Wind, description: "High-pitched crackling sounds", category: "Lung Sound Simulation" },
  { id: "wheezes", name: "Wheezes", icon: Wind, description: "High-pitched whistling sounds", category: "Lung Sound Simulation" },
];

// Group data types by category
const groupedDataTypes = dataTypes.reduce((acc, type) => {
  if (!acc[type.category]) acc[type.category] = [];
  acc[type.category].push(type);
  return acc;
}, {} as Record<string, typeof dataTypes>);

// ---------- Local generator utilities (per-type entry points) ----------
function noise(n: number) {
  return (Math.random() * 2 - 1) * n;
}

function synthBase(len: number, opts: { baseFreq: number; jitter?: number; overtones?: number[]; envelope?: (i: number) => number }) {
  const { baseFreq, jitter = 0, overtones = [], envelope } = opts;
  const out = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    let v = Math.sin(2 * Math.PI * (baseFreq * t + noise(jitter)));
    for (const o of overtones) v += 0.5 * Math.sin(2 * Math.PI * (o * baseFreq * t));
    if (envelope) v *= envelope(i);
    v += noise(0.05);
    out[i] = v;
  }
  return out;
}

// Heart S1/S2 pulse-like envelope
function heartEnvelope(len: number, cycles: number, split = 0.12) {
  const period = len / Math.max(1, cycles);
  return (i: number) => {
    const p = i % period;
    const s1 = Math.exp(-((p - period * 0.1) ** 2) / (period * 0.003));
    const s2 = Math.exp(-((p - period * (0.1 + split)) ** 2) / (period * 0.003));
    return s1 + 0.8 * s2;
  };
}

function genNormalHeart(count: number, cycles: number) {
  const { t, y } = simulateHeartDataset({ cycles, hr: 75, rrStdFrac: 0.03, awgnAmplitude: 0.05 });
  return resampleToLength(t, y, count);
}
function genValveDisease(count: number, cycles: number) {
  const { t, y } = simulateHeartDataset({ cycles, hr: 75, systolicMurmur: true, diastolicMurmur: false, continuousMurmur: false, awgnAmplitude: 0.05 });
  return resampleToLength(t, y, count);
}
function genPericardial(count: number, cycles: number) {
  const { t, y } = simulateHeartDataset({ cycles, hr: 75, friction: true, awgnAmplitude: 0.05 });
  return resampleToLength(t, y, count);
}
function genCongenital(count: number, cycles: number) {
  const { t, y } = simulateHeartDataset({ cycles, hr: 80, continuousMurmur: true, awgnAmplitude: 0.05 });
  return resampleToLength(t, y, count);
}
function genHeartFailure(count: number, cycles: number) {
  const { t, y } = simulateHeartDataset({ cycles, hr: 65, s3s4: true, awgnAmplitude: 0.05 });
  return resampleToLength(t, y, count);
}
function genArrhythmia(count: number, cycles: number) {
  const { t, y } = simulateHeartDataset({ cycles, hr: 75, rrStdFrac: 0.2, awgnAmplitude: 0.05 });
  return resampleToLength(t, y, count);
}
// Fetal heart sounds via Python-ported simulator (simulateFpcgDataset)
function genFhsNormal(count: number, cycles: number) {
  const { t, y } = simulateFpcgDataset({ cycles_per_sample: Math.max(1, Math.floor(cycles)), movement_enabled: false, uc_enabled: false });
  return resampleToLength(t, y, count);
}
function genFhsArrhythmia(count: number, cycles: number) {
  const { t, y } = simulateFpcgDataset({ cycles_per_sample: Math.max(1, Math.floor(cycles)), movement_enabled: false, uc_enabled: false, rr_std_frac: 0.15 });
  return resampleToLength(t, y, count);
}
function genFhsMoveStrong(count: number, cycles: number) {
  const { t, y } = simulateFpcgDataset({ cycles_per_sample: Math.max(1, Math.floor(cycles)), movement_enabled: true, movement_intensity: 2.0, movement_rate_per_min: 12, uc_enabled: false });
  return resampleToLength(t, y, count);
}
function genFhsMoveWeak(count: number, cycles: number) {
  const { t, y } = simulateFpcgDataset({ cycles_per_sample: Math.max(1, Math.floor(cycles)), movement_enabled: true, movement_intensity: 0.4, movement_rate_per_min: 4, uc_enabled: false });
  return resampleToLength(t, y, count);
}
function genFhsUcFast(count: number, cycles: number) {
  const { t, y } = simulateFpcgDataset({ cycles_per_sample: Math.max(1, Math.floor(cycles)), movement_enabled: false, uc_enabled: true, uc_rate_per_10min: 6.0, uc_duration_range: [10, 20] });
  return resampleToLength(t, y, count);
}
function genFhsUcSlow(count: number, cycles: number) {
  const { t, y } = simulateFpcgDataset({ cycles_per_sample: Math.max(1, Math.floor(cycles)), movement_enabled: false, uc_enabled: true, uc_rate_per_10min: 1.0, uc_duration_range: [20, 40] });
  return resampleToLength(t, y, count);
}
// Lung sounds
function genNormalLung(count: number, cycles: number) {
  return genNormalLungSignal(count, cycles);
}
function genCoarseCrackles(count: number, cycles: number) {
  return genCoarseCracklesSignal(count, cycles);
}
function genFineCrackles(count: number, cycles: number) {
  return genFineCracklesSignal(count, cycles);
}
function genWheezes(count: number, cycles: number) {
  return genWheezeSignal(count, cycles);
}

const generators: Record<string, (count: number, cycles: number) => number[]> = {
  normal_heart: genNormalHeart,
  valve_disease: genValveDisease,
  pericardial_disease: genPericardial,
  congenital_disease: genCongenital,
  heart_failure: genHeartFailure,
  arrhythmia: genArrhythmia,
  fhs_normal: genFhsNormal,
  fhs_arrhythmia: genFhsArrhythmia,
  fhs_move_strong: genFhsMoveStrong,
  fhs_move_weak: genFhsMoveWeak,
  fhs_uc_fast: genFhsUcFast,
  fhs_uc_slow: genFhsUcSlow,
  normal_lung: (c, cyc) => genNormalLung(c, cyc),
  coarse_crackles: (c, cyc) => genCoarseCrackles(c, cyc),
  fine_crackles: (c, cyc) => genFineCrackles(c, cyc),
  wheezes: (c, cyc) => genWheezes(c, cyc),
};

export default function Index() {
  const [selectedDataType, setSelectedDataType] = useState("");
  const [cycles, setCycles] = useState([100]);
  const [dataCount, setDataCount] = useState([1000]);
  const [seriesCount, setSeriesCount] = useState([1]);
  const [datasetCount, setDatasetCount] = useState([3]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState<DataPoint[]>([]);

  const handleGenerate = async () => {
    if (!selectedDataType) return;
    setIsGenerating(true);
    setTimeout(() => {
      const all: DataPoint[] = [];
      const gen = generators[selectedDataType] ?? genNormalHeart;
      const totalSeries = Math.max(1, datasetCount[0]);
      for (let s = 0; s < totalSeries; s++) {
        const values = gen(dataCount[0], cycles[0]).map((v) => v * (1 + (s * 0.05)) + noise(0.02 * s));
        for (let i = 0; i < values.length; i++) {
          all.push({ timestamp: i, value: values[i], type: selectedDataType, series: s });
        }
      }
      setGeneratedData(all);
      setIsGenerating(false);
    }, 600);
  };

  const handleDownload = () => {
    if (generatedData.length === 0) return;
    const csvContent =
      "data:text/csv;charset=utf-8," +
      "timestamp,value,type,series\n" +
      generatedData.map((row) => `${row.timestamp},${row.value},${row.type},${row.series}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `auscultsim_${selectedDataType}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedType = dataTypes.find((type) => type.id === selectedDataType);

  // Build preview series grouped data
  const seriesIdsAll = useMemo(
    () => Array.from(new Set(generatedData.map((d) => d.series))).sort((a, b) => a - b),
    [generatedData]
  );
  const seriesIds = seriesIdsAll.slice(0, seriesCount[0]);

  const colors = ["#60a5fa", "#22d3ee", "#a78bfa", "#34d399", "#f472b6"]; // blue, cyan, violet, green, pink

  return (
    <div className="min-h-screen bg-gradient-to-br from-tech-dark-900 via-tech-blue-950 to-tech-dark-900">
      <header className="border-b border-tech-blue-800/30 bg-tech-dark-900/50 backdrop-blur-xl">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <img
                src="https://cdn.builder.io/api/v1/image/assets%2F48e66d8efd9b4605abd90c97e923384d%2Fc920a09c86384c88aff437ac5866d971?format=webp&width=800"
                alt="AuscultSim Logo"
                className="h-10 w-auto"
              />
              <div>
                <h1 className="text-2xl font-bold text-white">AuscultSim</h1>
                <p className="text-sm text-tech-blue-300">Auscultation Sound Simulation Generator</p>
              </div>
            </div>
            <Badge variant="outline" className="border-tech-blue-500 text-tech-blue-300">v1.0.0</Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Card className="bg-tech-dark-800/50 border-tech-blue-800/30 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings className="h-5 w-5 text-tech-blue-400" />
                  Medical Data Type Selection
                </CardTitle>
                <CardDescription className="text-tech-blue-300">
                  Choose the type of auscultation sound you want to simulate
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                {Object.entries(groupedDataTypes).map(([category, types]) => (
                  <div key={category}>
                    <h3 className="text-lg font-semibold text-tech-blue-2 00 mb-4 border-b border-tech-blue-800/30 pb-2">
                      {category}
                    </h3>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {types.map((type) => {
                        const Icon = type.icon;
                        const isSelected = selectedDataType === type.id;
                      return (
                        <Card
                          key={type.id}
                          className={`cursor-pointer transition-all duration-200 hover:scale-105 ${
                            isSelected
                              ? "bg-tech-blue-600/20 border-tech-blue-500 shadow-lg shadow-tech-blue-500/20"
                              : "bg-tech-dark-700/50 border-tech-blue-800/30 hover:border-tech-blue-600"
                          }`}
                          onClick={() => setSelectedDataType(type.id)}
                        >
                          <CardContent className="p-4">
                            <div className="flex flex-col items-center text-center space-y-2">
                              <div className={`p-3 rounded-full ${isSelected ? "bg-tech-blue-500" : "bg-tech-blue-600/20"}`}>
                                <Icon className={`h-6 w-6 ${isSelected ? "text-white" : "text-tech-blue-400"}`} />
                              </div>
                              <h3 className={`font-semibold text-sm ${isSelected ? "text-white" : "text-tech-blue-200"}`}>{type.name}</h3>
                              <p className={`text-xs ${isSelected ? "text-tech-blue-300" : "text-tech-blue-400"}`}>{type.description}</p>
                            </div>
                          </CardContent>
                        </Card>
                      );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {selectedDataType && (
              <Card className="mt-6 bg-tech-dark-800/50 border-tech-blue-800/30 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-white">Generation Parameters</CardTitle>
                  <CardDescription className="text-tech-blue-300">Configure the detailed parameters for data generation</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-tech-blue-200">Generation Cycles: {cycles[0]}</Label>
                      <Slider value={cycles} onValueChange={setCycles} max={1000} min={5} step={5} className="w-full" />
                      <div className="flex justify-between text-xs text-tech-blue-400"><span>5</span><span>1000</span></div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-tech-blue-200">Data Points: {dataCount[0]}</Label>
                      <Slider value={dataCount} onValueChange={setDataCount} max={20000} min={100} step={100} className="w-full" />
                      <div className="flex justify-between text-xs text-tech-blue-400"><span>100</span><span>20,000</span></div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-tech-blue-200">Visualization Series: {seriesCount[0]}</Label>
                      <Slider value={seriesCount} onValueChange={setSeriesCount} max={10} min={1} step={1} className="w-full" />
                      <div className="flex justify-between text-xs text-tech-blue-400"><span>1</span><span>10</span></div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-tech-blue-200">Datasets to Generate: {datasetCount[0]}</Label>
                      <Slider value={datasetCount} onValueChange={setDatasetCount} max={50} min={1} step={1} className="w-full" />
                      <div className="flex justify-between text-xs text-tech-blue-400"><span>1</span><span>50</span></div>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <Button onClick={handleGenerate} disabled={isGenerating} className="flex-1 bg-tech-blue-600 hover:bg-tech-blue-700 text-white">
                      {isGenerating ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Start Generation
                        </>
                      )}
                    </Button>

                    <Button onClick={handleDownload} disabled={generatedData.length === 0} variant="outline" className="border-tech-blue-500 text-tech-blue-300 hover:bg-tech-blue-600/20">
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="lg:col-span-1">
            <Card className="bg-tech-dark-800/50 border-tech-blue-800/30 backdrop-blur-sm h-fit">
              <CardHeader>
                <CardTitle className="text-white">Data Preview</CardTitle>
                <CardDescription className="text-tech-blue-300">Real-time preview of generated data</CardDescription>
              </CardHeader>
              <CardContent>
                {generatedData.length > 0 ? (
                  <div className="space-y-4">
                    <div className="bg-tech-dark-900/50 rounded-lg p-4">
                      <div className="text-center space-y-2">
                        <div className="text-2xl font-bold text-tech-blue-400">{generatedData.length.toLocaleString()}</div>
                        <div className="text-sm text-tech-blue-300">Data Points</div>
                      </div>
                    </div>

                    <div className="bg-tech-dark-900/50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-tech-blue-200 mb-2">Data Statistics</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between"><span className="text-tech-blue-400">Type:</span><span className="text-white">{selectedType?.name || selectedDataType}</span></div>
                        <div className="flex justify-between"><span className="text-tech-blue-400">Category:</span><span className="text-white">{selectedType?.category}</span></div>
                        <div className="flex justify-between"><span className="text-tech-blue-400">Cycles:</span><span className="text-white">{cycles[0]}</span></div>
                        <div className="flex justify-between"><span className="text-tech-blue-400">Generated Series:</span><span className="text-white">{datasetCount[0]}</span></div>
                        <div className="flex justify-between"><span className="text-tech-blue-400">Shown:</span><span className="text-white">{seriesCount[0]}</span></div>
                        <div className="flex justify-between"><span className="text-tech-blue-400">Sample Rate:</span><span className="text-white">1000 Hz</span></div>
                      </div>
                    </div>

                    <div className="bg-tech-dark-900/50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-tech-blue-200 mb-3">Waveform Preview</h4>
                      <div className="space-y-3">
                        {seriesIds.map((s, idx) => {
                          const full = generatedData.filter((d) => d.series === s);
                          const drawLen = Math.min(1000, full.length);
                          const seriesData = full.slice(0, drawLen);
                          const maxAbs = Math.max(1e-6, ...seriesData.map(d => Math.abs(d.value)));
                          const pts = seriesData
                            .map((d, i) => `${(i / Math.max(1, drawLen - 1)) * 100},${50 - (d.value / maxAbs) * 40}`)
                            .join(" ");
                          return (
                            <div key={s} className="bg-tech-dark-900/60 rounded-md p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-xs text-tech-blue-300">
                                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[idx % colors.length] }} />
                                  Series {s + 1}
                                </div>
                                <div className="text-xs text-tech-blue-400">auto-scaled preview</div>
                              </div>
                              <div className="h-24 bg-tech-dark-800 rounded relative overflow-hidden">
                                <svg className="w-full h-full">
                                  <polyline points={pts} fill="none" stroke={colors[idx % colors.length]} strokeWidth="1" />
                                </svg>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Stethoscope className="h-12 w-12 text-tech-blue-600 mx-auto mb-4" />
                    <p className="text-tech-blue-400">Select a data type and click generate</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
