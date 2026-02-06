import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'

// --- 型定義 ---
interface CarDetails {
  name: string; customerName: string; color: string; status: string; plate: string;
  carManager: string; entryManager: string; entryDate: string; memo: string;
}

interface Slot {
  id: number; label: string; area_name: string; car: CarDetails | null;
  editing_id: string | null; last_ping: string | null;
}

// --- 定数 ---
const AREAS = ["裏駐車場", "タワー", "極上仕上場"];
const STAFF_LIST = ["岡﨑 有功", "森岡 央行", "岡本 康一", "岡本 慎平", "谷本 貢一", "朝栄 拓海", "亀島 大夢", "淺野 佳菜子", "坪井 美佳", "杉山 詩織", "難波 成美", "平井 旭", "中村 俊也", "岸戸 彪我", "藤田 陸", "藤田 佳代", "福家 君佳", "安達 未来", "田中 美夕日", "平山 暁美", "松本 由香", "高下 ゆかり", "松浦 広司", "平塚 円", "坂口 達哉", "藤井 武司", "上山 紀昭"];
const STATUS_LIST = ['売約済(小売)', '売約済(AA/業販)', '在庫', 'AA行き', '解体予定', '代車', 'レンタカー', '車検預かり', '整備預かり', 'その他'];

const getMyId = () => {
  let id = localStorage.getItem('parking_user_id');
  if (!id) {
    id = 'user-' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('parking_user_id', id);
  }
  return id;
};

function App() {
  const myId = useMemo(() => getMyId(), []);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [currentArea, setCurrentArea] = useState(AREAS[0]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetSlotId, setTargetSlotId] = useState<number | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isMoveMode, setIsMoveMode] = useState(false); 
  const [moveSourceId, setMoveSourceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pooledCar, setPooledCar] = useState<CarDetails | null>(null);
  const [filterManager, setFilterManager] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const initialFormData: CarDetails = {
    name: '', customerName: '', color: '', status: '', plate: '有', carManager: '', entryManager: '', entryDate: '', memo: ''
  };
  const [formData, setFormData] = useState<CarDetails>(initialFormData);

  // --- 共通ロジック ---
  const isLockExpired = (lastPing: string | null) => {
    if (!lastPing) return true;
    const last = new Date(lastPing).getTime();
    const now = new Date().getTime();
    return (now - last) > 5 * 60 * 1000;
  };

  const fetchSlots = useCallback(async () => {
    const { data, error } = await supabase.from('parking_slots').select('*').order('id', { ascending: true });
    if (!error && data) {
      const formatted: Slot[] = data.map(d => ({
        id: d.id, label: d.label, area_name: d.area_name || '裏駐車場',
        editing_id: d.editing_id, last_ping: d.last_ping,
        car: d.car_name ? {
          name: d.car_name, customerName: d.customer_name || '', color: d.color, status: d.status || '',
          plate: d.plate || '有', carManager: d.car_manager || '', entryManager: d.entry_manager || '', 
          entryDate: d.entry_date, memo: d.memo
        } : null
      }));
      setSlots(formatted);
      setTimeout(() => setLoading(false), 1800);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    const channel = supabase.channel('schema-db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, () => fetchSlots()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSlots]);

  // --- 極上仕上場用：座標マッピング（PDF資料を完全再現） ---
  const getGokujoPosition = (label: string) => {
    const map: { [key: string]: { row: string, col: string } } = {
      "東1": { row: "1", col: "1/5" }, "東2": { row: "2", col: "1/5" }, "東3": { row: "3", col: "1/5" }, "東4": { row: "4", col: "1/5" },
      "東5": { row: "5", col: "1/5" }, "東6": { row: "6", col: "1/5" }, "東7": { row: "7", col: "1/5" }, "東8": { row: "8", col: "1/5" },
      "予備": { row: "1/9", col: "7/10" }, "スタジオ": { row: "1/3", col: "11/13" }, "掃除スペース": { row: "4", col: "11/13" },
      "ポート": { row: "9/12", col: "9/13" },
      "西1": { row: "11", col: "1" }, "西2": { row: "11", col: "2" }, "西3": { row: "11", col: "3" }, "西4": { row: "11", col: "4" },
      "西5": { row: "11", col: "5" }, "西6": { row: "11", col: "6" }, "西7": { row: "11", col: "7" }, "西8": { row: "11", col: "8" },
    };
    return map[label.replace(/\s/g, "")] || null;
  };

  const filteredSlots = useMemo(() => {
    const base = slots.filter(s => s.area_name === currentArea);
    if (currentArea === 'タワー') {
      return [...base].sort((a, b) => {
        const aNum = parseInt(a.label.replace(/[^0-9]/g, '')) || 0;
        const bNum = parseInt(b.label.replace(/[^0-9]/g, '')) || 0;
        return (aNum <= 15 ? 0 : 1) - (bNum <= 15 ? 0 : 1) || aNum - bNum;
      });
    }
    return base;
  }, [slots, currentArea]);

  // --- 操作系関数 ---
  const handleMove = async (toId: number) => {
    const sourceSlot = slots.find(s => s.id === moveSourceId);
    if (!sourceSlot || !sourceSlot.car) return;
    await supabase.from('parking_slots').update({ ...sourceSlot.car, car_name: sourceSlot.car.name, customer_name: sourceSlot.car.customerName, editing_id: null }).eq('id', toId);
    await supabase.from('parking_slots').update({ car_name: null, customer_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null }).eq('id', moveSourceId);
    setMoveSourceId(null); fetchSlots();
  };

  const handleEntry = async () => {
    if (!targetSlotId) return;
    await supabase.from('parking_slots').update({
      car_name: formData.name, customer_name: formData.customerName, color: formData.color, status: formData.status,
      plate: formData.plate, car_manager: formData.carManager, entry_manager: formData.entryManager, 
      entry_date: formData.entryDate, memo: formData.memo, editing_id: null, last_ping: null
    }).eq('id', targetSlotId);
    setIsModalOpen(false); setTargetSlotId(null); fetchSlots();
  };

  // --- UIレンダリング ---
  if (loading) return (
    <div style={loadingContainerStyle}>
      <style>{`@keyframes fill-color { 0% { width: 0%; } 100% { width: 100%; } }`}</style>
      <div style={logoWrapperStyle}>
        <img src="/logo.png" style={{ ...logoBaseStyle, filter: 'grayscale(100%) opacity(0.1)' }} />
        <div style={logoColorFillStyle}><img src="/logo.png" style={logoBaseStyle} /></div>
      </div>
      <div style={{ marginTop: '20px', fontWeight: 'bold', color: '#666', letterSpacing: '2px' }}>LOADING</div>
    </div>
  );

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', width: '100%', fontFamily: 'sans-serif' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#fff', padding: '15px 0', borderBottom: '1px solid #eee', textAlign: 'center' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>🚗 拠点別駐車場管理</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', backgroundColor: '#fff', padding: '10px', gap: '8px', overflowX: 'auto', borderBottom: '1px solid #ddd', justifyContent: 'center' }}>
        {AREAS.map(area => (
          <button key={area} onClick={() => setCurrentArea(area)} style={{ padding: '8px 20px', borderRadius: '20px', border: '1px solid #ddd', fontSize: '14px', fontWeight: 'bold', backgroundColor: currentArea === area ? '#007bff' : '#f8f9fa', color: currentArea === area ? '#fff' : '#333' }}>{area}</button>
        ))}
      </div>

      {/* Grid Container */}
      <div style={{ width: '100%', overflowX: 'auto', padding: '20px 0 150px 0', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ 
          display: 'grid', margin: '0 auto', padding: '0 15px', gap: '12px',
          width: currentArea === '極上仕上場' ? '1200px' : '95%',
          gridTemplateColumns: currentArea === '極上仕上場' ? 'repeat(12, 1fr)' : (currentArea === '裏駐車場' ? '1.8fr 1fr 1fr 1fr 1.8fr' : '1fr 1fr'),
        }}>
          {filteredSlots.map((slot) => {
            const pos = currentArea === '極上仕上場' ? getGokujoPosition(slot.label) : null;
            const isEditing = slot.editing_id !== null && slot.editing_id !== myId && !isLockExpired(slot.last_ping);
            
            return (
              <div 
                key={slot.id} 
                onClick={() => {
                  if (isMoveMode) {
                    if (!moveSourceId && slot.car) setMoveSourceId(slot.id);
                    else if (moveSourceId) handleMove(slot.id);
                  } else {
                    setTargetSlotId(slot.id); setFormData(slot.car || initialFormData); setIsModalOpen(true);
                  }
                }}
                style={{
                  minHeight: '85px', borderRadius: '8px', border: '1px solid #ccc', padding: '8px', cursor: 'pointer',
                  backgroundColor: isEditing ? '#ffe5e5' : (moveSourceId === slot.id ? '#ffc107' : (slot.car ? '#fff' : '#f0f0f0')),
                  gridRow: pos?.row, gridColumn: pos?.col,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: slot.car ? '0 2px 5px rgba(0,0,0,0.05)' : 'none',
                  borderColor: isEditing ? '#dc3545' : (slot.car ? '#007bff' : '#ccc')
                }}
              >
                <span style={{ fontSize: '10px', color: '#999', marginBottom: '4px' }}>{slot.label}</span>
                <span style={{ fontWeight: 'bold', fontSize: '12px', textAlign: 'center' }}>
                  {isEditing ? '入力中' : (slot.car?.name || '空')}
                </span>
                {slot.car && <span style={{ fontSize: '10px', color: '#007bff', marginTop: '4px' }}>{slot.car.status}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Buttons */}
      <div style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '10px', zIndex: 100 }}>
        <button onClick={() => {setIsMoveMode(!isMoveMode); setMoveSourceId(null);}} style={{ padding: '12px 25px', borderRadius: '30px', border: 'none', backgroundColor: isMoveMode ? '#ffc107' : '#6c757d', color: '#fff', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {isMoveMode ? '移動キャンセル' : '車両を移動する'}
        </button>
      </div>

      {/* Entry Modal */}
      {isModalOpen && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>車両情報入力</h2>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input placeholder="車名" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} />
              <input placeholder="お客様名" value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} style={inputStyle} />
              <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={inputStyle}>
                <option value="">状況を選択</option>
                {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <textarea placeholder="備考" value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{ ...inputStyle, height: '80px' }} />
            </div>
            <div style={{ padding: '20px', display: 'flex', gap: '10px', borderTop: '1px solid #eee' }}>
              <button onClick={handleEntry} style={{ flex: 1, padding: '12px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}>保存する</button>
              <button onClick={() => setIsModalOpen(false)} style={{ flex: 1, padding: '12px', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '8px' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- スタイル定義 ---
const loadingContainerStyle = { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#fff' };
const logoWrapperStyle = { position: 'relative' as const, width: '180px' };
const logoBaseStyle = { width: '100%', height: 'auto' };
const logoColorFillStyle = { position: 'absolute' as const, top: 0, left: 0, width: '0%', height: '100%', overflow: 'hidden', animation: 'fill-color 1.5s ease-in-out forwards' };
const modalOverlayStyle = { position: 'fixed' as const, top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContentStyle = { backgroundColor: '#fff', width: '90%', maxWidth: '450px', borderRadius: '12px', overflow: 'hidden' };
const inputStyle = { width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px', boxSizing: 'border-box' as const };

export default App;