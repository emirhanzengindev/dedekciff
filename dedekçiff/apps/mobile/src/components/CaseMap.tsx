import { MaterialCommunityIcons } from "@expo/vector-icons";
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

interface Location {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface MapPoint {
  x: number;
  y: number;
}

const positions: Record<string, MapPoint> = {
  police_station: { x: 94, y: 438 },
  victim_home: { x: 287, y: 190 },
  suspect_home: { x: 91, y: 262 },
  show_room: { x: 286, y: 431 },
  bank: { x: 104, y: 623 }
};

const icons: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  police_station: "police-station",
  victim_home: "home-map-marker",
  suspect_home: "home-map-marker",
  show_room: "magnify",
  bank: "bank"
};

export function CaseMap({
  locations,
  onLocationPress,
  selectedLocationId
}: {
  locations: Location[];
  onLocationPress: (id: string) => void;
  selectedLocationId?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const viewWidth = 390 / zoom;
  const viewHeight = 720 / zoom;
  const originX = (390 - viewWidth) / 2;
  const originY = (720 - viewHeight) / 2;
  const destination = selectedLocationId ? positions[selectedLocationId] : undefined;
  const station = positions.police_station;
  const routePath = destination && destination !== station
    ? `M ${station.x} ${station.y} Q ${(station.x + destination.x) / 2 + 24} ${(station.y + destination.y) / 2} ${destination.x} ${destination.y}`
    : undefined;

  return (
    <View style={styles.map}>
      <Svg style={StyleSheet.absoluteFill} viewBox={`${originX} ${originY} ${viewWidth} ${viewHeight}`} preserveAspectRatio="none">
        <Rect width="390" height="720" fill="#DDE6D9" />
        <Path d="M-40 105 C55 75 111 132 165 101 S278 69 430 115 L430 171 C304 125 251 184 173 160 S50 133 -40 178Z" fill="#C8DEE0" />
        <Path d="M-35 282 L130 205 L182 251 L28 342Z" fill="#CBD6C9" />
        <Path d="M226 126 L392 88 L424 156 L255 205Z" fill="#CFD9CA" />
        <Path d="M-24 548 L101 489 L152 548 L30 614Z" fill="#C8D5C5" />
        <Path d="M231 514 L404 451 L427 527 L257 592Z" fill="#C8D5C5" />
        <Path d="M-20 372 C72 342 131 390 204 359 S324 324 420 349" fill="none" stroke="#F9F5E9" strokeWidth="34" />
        <Path d="M180 70 C204 180 169 270 204 357 S224 512 194 750" fill="none" stroke="#F9F5E9" strokeWidth="31" />
        <Path d="M-10 213 C95 238 156 211 255 241 S345 278 409 258" fill="none" stroke="#F9F5E9" strokeWidth="19" />
        <Path d="M-5 470 C92 450 145 483 228 463 S331 435 402 451" fill="none" stroke="#F9F5E9" strokeWidth="18" />
        <Path d="M63 80 C93 148 80 229 105 288 M324 182 C292 243 317 306 340 364 M79 530 C118 567 118 626 86 690 M280 500 C316 550 310 605 338 669" fill="none" stroke="#F9F5E9" strokeWidth="12" />
        <Path d="M-10 372 C72 342 131 390 204 359 S324 324 420 349 M180 70 C204 180 169 270 204 357 S224 512 194 750" fill="none" stroke="#CFBE91" strokeDasharray="5 10" strokeWidth="2" />
        {routePath ? <Path d={routePath} fill="none" stroke="#397A6A" strokeDasharray="7 7" strokeLinecap="round" strokeWidth="5" opacity="0.85" /> : null}
        <Rect x="18" y="190" width="50" height="38" rx="5" fill="#B8C6B7" />
        <Rect x="87" y="196" width="46" height="37" rx="5" fill="#B8C6B7" />
        <Rect x="267" y="223" width="47" height="38" rx="5" fill="#B8C6B7" />
        <Rect x="324" y="218" width="42" height="37" rx="5" fill="#B8C6B7" />
        <Rect x="25" y="293" width="56" height="31" rx="5" fill="#B8C6B7" />
        <Rect x="285" y="296" width="58" height="29" rx="5" fill="#B8C6B7" />
        <Rect x="244" y="554" width="51" height="34" rx="5" fill="#B8C6B7" />
        <Rect x="304" y="552" width="48" height="34" rx="5" fill="#B8C6B7" />
        <Circle cx="333" cy="91" r="42" fill="#B8D0B1" />
        <Circle cx="334" cy="91" r="23" fill="#C4D8BD" />
        <Circle cx="48" cy="640" r="35" fill="#B8D0B1" />
        <Circle cx="48" cy="640" r="18" fill="#C4D8BD" />
        <SvgText x="18" y="55" fill="#56706B" fontSize="12" fontWeight="700" letterSpacing="1">GÜMÜŞTEPE</SvgText>
        <SvgText x="239" y="112" fill="#718278" fontSize="10" fontWeight="600">KUZEY PARKI</SvgText>
        <SvgText x="17" y="349" fill="#89968A" fontSize="9">SAHİL YOLU</SvgText>
        <SvgText x="231" y="685" fill="#89968A" fontSize="9">İSTASYON CADDESİ</SvgText>
        <SvgText x="296" y="391" fill="#89968A" fontSize="9">ESKİ ÇARŞI</SvgText>
      </Svg>

      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {locations.map((location) => {
          const point = positions[location.id] ?? { x: 195, y: 360 };
          const selected = location.id === selectedLocationId;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${location.name}. ${location.description}`}
              key={location.id}
              onPress={() => onLocationPress(location.id)}
              style={[
                styles.pin,
                { left: `${((point.x - originX) / viewWidth) * 100}%`, top: `${((point.y - originY) / viewHeight) * 100}%` },
                selected && styles.pinSelected
              ]}
            >
              <View style={[styles.pinIcon, selected && styles.pinIconSelected]}>
                <MaterialCommunityIcons name={icons[location.id] ?? "map-marker"} size={23} color={selected ? "#FFFFFF" : "#244F49"} />
              </View>
              <Text numberOfLines={2} style={[styles.pinLabel, selected && styles.pinLabelSelected]}>{location.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <View pointerEvents="none" style={styles.mapStamp}>
        <Text style={styles.mapStampTop}>SAHA HARİTASI</Text>
        <Text style={styles.mapStampBottom}>DOSYA 001</Text>
      </View>
      <View style={styles.mapControls}>
        <View accessibilityLabel="Kuzey yönü" style={styles.compass}>
          <MaterialCommunityIcons name="navigation" color="#315E55" size={18} />
          <Text style={styles.compassText}>K</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Haritayı yakınlaştır" disabled={zoom >= 1.6} onPress={() => setZoom((value) => Math.min(1.6, Number((value + 0.2).toFixed(1))))} style={styles.zoomButton}>
          <MaterialCommunityIcons name="plus" color="#315E55" size={21} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Haritayı uzaklaştır" disabled={zoom <= 1} onPress={() => setZoom((value) => Math.max(1, Number((value - 0.2).toFixed(1))))} style={[styles.zoomButton, zoom <= 1 && styles.zoomDisabled]}>
          <MaterialCommunityIcons name="minus" color="#315E55" size={21} />
        </Pressable>
      </View>
      <View pointerEvents="none" style={styles.mapScale}>
        <View style={styles.mapScaleLine} />
        <Text style={styles.mapScaleText}>500 m · şematik</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { backgroundColor: "#DDE6D9", borderRadius: 10, flex: 1, minHeight: 380, overflow: "hidden", position: "relative" },
  pin: { alignItems: "center", marginLeft: -48, marginTop: -29, position: "absolute", width: 96 },
  pinSelected: { zIndex: 2 },
  pinIcon: { alignItems: "center", backgroundColor: "#F7F4E9", borderColor: "#738B77", borderRadius: 23, borderWidth: 2, elevation: 3, height: 46, justifyContent: "center", shadowColor: "#243A35", shadowOffset: { height: 2, width: 0 }, shadowOpacity: 0.2, shadowRadius: 3, width: 46 },
  pinIconSelected: { backgroundColor: "#396F63", borderColor: "#FFFFFF", transform: [{ scale: 1.08 }] },
  pinLabel: { backgroundColor: "#F6F3E8", borderColor: "#C2CBBB", borderRadius: 5, borderWidth: 1, color: "#344D46", fontSize: 10, fontWeight: "700", marginTop: 3, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3, textAlign: "center" },
  pinLabelSelected: { backgroundColor: "#284F49", borderColor: "#284F49", color: "#FFFFFF" },
  mapStamp: { backgroundColor: "rgba(249,247,238,0.88)", borderColor: "#AEBDAE", borderRadius: 6, borderWidth: 1, left: 12, paddingHorizontal: 9, paddingVertical: 6, position: "absolute", top: 12 },
  mapStampTop: { color: "#365D54", fontSize: 9, fontWeight: "800" },
  mapStampBottom: { color: "#6F8175", fontSize: 8, marginTop: 2 },
  mapControls: { alignItems: "center", gap: 6, position: "absolute", right: 12, top: 12 },
  compass: { alignItems: "center", backgroundColor: "rgba(249,247,238,0.94)", borderColor: "#AEBDAE", borderRadius: 6, borderWidth: 1, height: 44, justifyContent: "center", width: 42 },
  compassText: { color: "#365D54", fontSize: 8, fontWeight: "800" },
  zoomButton: { alignItems: "center", backgroundColor: "rgba(249,247,238,0.96)", borderColor: "#AEBDAE", borderRadius: 6, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  zoomDisabled: { opacity: 0.55 },
  mapScale: { alignItems: "center", bottom: 13, left: 12, position: "absolute" },
  mapScaleLine: { borderColor: "#526A60", borderTopWidth: 2, height: 7, width: 42 },
  mapScaleText: { color: "#526A60", fontSize: 8, fontWeight: "700" }
});