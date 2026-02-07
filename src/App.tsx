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
  const [filterManager, setFilterManager] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const initialFormData: CarDetails = {
    name: '', customerName: '', color: '', status: '', plate: '有', carManager: '', entryManager: '', entryDate: '', memo: ''
  };
  const [formData, setFormData] = useState<CarDetails>(initialFormData);

  // --- ヘルパー ---
  const isLockExpired = (lastPing: string | null) => {
    if (!lastPing) return true;
    const last = new Date(lastPing).getTime();
    const now = new Date().getTime();
    return (now - last) > 5 * 60 * 1000;
  };

  const getNowTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}/${(now.getMonth()+1)}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
  };

  // --- データ取得 ---
  const fetchSlots = useCallback(async () => {
    const { data, error } = await supabase.from('parking_slots').select('*').order('id', { ascending: true });
    if (!error && data) {
      const formatted: Slot[] = data.map(d => {
        let displayLabel = d.label;
        // 裏駐車場のラベル変換ロジックを維持
        if (d.area_name === '裏駐車場' && d.label.startsWith('東-')) {
          const num = parseInt(d.label.replace('東-', ''));
          if (num >= 1 && num <= 10) displayLabel = `東-${num + 15}`;
        }
        return {
          id: d.id, label: displayLabel, area_name: d.area_name || '裏駐車場',
          editing_id: d.editing_id, last_ping: d.last_ping,
          car: d.car_name ? {
            name: d.car_name, customerName: d.customer_name || '', color: d.color || '', status: d.status || '',
            plate: d.plate || '有', carManager: d.car_manager || '', entryManager: d.entry_manager || '', 
            entryDate: d.entry_date || '', memo: d.memo || ''
          } : null
        };
      });
      setSlots(formatted);
      setTimeout(() => setLoading(false), 1500);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    const channel = supabase.channel('db-all').on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, () => fetchSlots()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSlots]);

  // 入力中Ping
  useEffect(() => {
    if (!isModalOpen || !targetSlotId) return;
    const interval = setInterval(() => {
      supabase.from('parking_slots').update({ last_ping: new Date().toISOString() }).eq('id', targetSlotId);
    }, 30000);
    return () => clearInterval(interval);
  }, [isModalOpen, targetSlotId]);

  // --- 極上仕上場レイアウト定義 ---
  const getGokujoPosition = (label: string) => {
    const cleanLabel = label.replace(/\s/g, "");
    const map: { [key: string]: { row: string, col: string } } = {
      "東1": { row: "1", col: "1/5" }, "東2": { row: "2", col: "1/5" }, "東3": { row: "3", col: "1/5" }, "東4": { row: "4", col: "1/5" },
      "東5": { row: "5", col: "1/5" }, "東6": { row: "6", col: "1/5" }, "東7": { row: "7", col: "1/5" }, "東8": { row: "8", col: "1/5" },
      "予備": { row: "1/9", col: "7/10" }, "スタジオ": { row: "1/3", col: "11/13" }, "掃除スペース": { row: "4", col: "11/13" },
      "ポート": { row: "9/12", col: "9/13" },
      "西1": { row: "11", col: "1" }, "西2": { row: "11", col: "2" }, "西3": { row: "11", col: "3" }, "西4": { row: "11", col: "4" },
      "西5": { row: "11", col: "5" }, "西6": { row: "11", col: "6" }, "西7": { row: "11", col: "7" }, "西8": { row: "11", col: "8" },
    };
    return map[cleanLabel] || null;
  };

  const filteredSlots = useMemo(() => {
    const base = slots.filter(s => s.area_name === currentArea);
    if (currentArea === 'タワー') {
      return [...base].sort((a, b) => {
        const aNum = parseInt(a.label.replace(/[^0-9]/g, '')) || 0;
        const bNum = parseInt(b.label.replace(/[^0-9]/g, '')) || 0;
        const aSide = aNum <= 15 ? 0 : 1;
        const bSide = bNum <= 15 ? 0 : 1;
        if (aSide !== bSide) return aSide - bSide;
        return aNum - bNum;
      });
    }
    return base;
  }, [slots, currentArea]);

  // --- アクション ---
  const openForm = async (slot: Slot) => {
    const isLocked = slot.editing_id && !isLockExpired(slot.last_ping);
    if (isLocked && slot.editing_id !== myId) {
      if(!confirm('他の方が入力中ですが、強制的に編集を開始しますか？')) return;
    }
    await supabase.from('parking_slots').update({ editing_id: myId, last_ping: new Date().toISOString() }).eq('id', slot.id);
    setTargetSlotId(slot.id);
    setFormData(slot.car || initialFormData);
    setIsModalOpen(true);
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

  const handleMove = async (toId: number) => {
    const src = slots.find(s => s.id === moveSourceId);
    if (!src || !src.car) return;
    await supabase.from('parking_slots').update({ ...src.car, car_name: src.car.name, customer_name: src.car.customerName, editing_id: null }).eq('id', toId);
    await supabase.from('parking_slots').update({ car_name: null, customer_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null, editing_id: null }).eq('id', moveSourceId);
    setMoveSourceId(null); fetchSlots();
  };

  const handleBulkClear = async () => {
    if (!confirm(`${selectedIds.length}台を削除しますか？`)) return;
    await supabase.from('parking_slots').update({ car_name: null, customer_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null, editing_id: null }).in('id', selectedIds);
    setSelectedIds([]); setIsSelectionMode(false); fetchSlots();
  };

  if (loading) return (
    <div style={loadingContainerStyle}>
      <style>{`@keyframes fill-color { 0% { width: 0%; } 100% { width: 100%; } } @keyframes blink { 0%, 100% { border-color: #007bff; box-shadow: 0 0 5px #007bff; } 50% { border-color: #00d4ff; box-shadow: 0 0 15px #00d4ff; } }`}</style>
      <div style={logoWrapperStyle}><img src="/logo.png" style={{ ...logoBaseStyle, filter: 'grayscale(100%) opacity(0.15)' }} alt="logo" /><div style={logoColorFillStyle}><img src="/logo.png" style={logoBaseStyle} alt="logo" /></div></div>
    </div>
  );

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', width: '100%', fontFamily: 'sans-serif' }}>
      <header style={{ backgroundColor: '#fff', padding: '15px 0', borderBottom: '1px solid #eee', textAlign: 'center' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 10px 0' }}>🚗 拠点別駐車場管理</h1>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px' }}>
          {AREAS.map(a => <button key={a} onClick={() => {setCurrentArea(a); setSelectedIds([]); setIsMoveMode(false);}} style={{ padding: '8px 15px', borderRadius: '20px', border: '1px solid #ddd', fontSize: '12px', fontWeight: 'bold', backgroundColor: currentArea === a ? '#007bff' : '#fff', color: currentArea === a ? '#fff' : '#333' }}>{a}</button>)}
        </div>
      </header>

      <div style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#fff', padding: '10px', borderBottom: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px' }}>
          <select value={filterManager} onChange={e => setFilterManager(e.target.value)} style={filterSelectStyle}><option value="">担当者</option>{STAFF_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={filterSelectStyle}><option value="">状況</option>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <button onClick={() => {setFilterManager(''); setFilterStatus('');}} style={{ padding: '0 10px', border: 'none', borderRadius: '5px', backgroundColor: '#666', color: '#fff' }}>解除</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <button onClick={() => {setIsMoveMode(false); setIsSelectionMode(false);}} style={{ ...navButtonStyle, backgroundColor: !isMoveMode && !isSelectionMode ? '#007bff' : '#eee', color: !isMoveMode && !isSelectionMode ? '#fff' : '#333' }}>入力</button>
          <button onClick={() => {setIsMoveMode(true); setIsSelectionMode(false); setMoveSourceId(null);}} style={{ ...navButtonStyle, backgroundColor: isMoveMode ? '#ffc107' : '#eee' }}>移動</button>
          <button onClick={() => {setIsSelectionMode(true); setIsMoveMode(false); setSelectedIds([]);}} style={{ ...navButtonStyle, backgroundColor: isSelectionMode ? '#dc3545' : '#eee', color: isSelectionMode ? '#fff' : '#333' }}>削除</button>
        </div>
      </div>

      <main style={{ width: '100%', overflowX: 'auto', padding: '20px 0 150px 0' }}>
        <div style={{ 
          display: 'grid', margin: '0 auto', padding: '0 15px', gap: '10px',
          width: currentArea === '極上仕上場' ? '1200px' : '95%',
          gridTemplateColumns: currentArea === '極上仕上場' ? 'repeat(12, 1fr)' : (currentArea === '裏駐車場' ? '1.8fr 1fr 1fr 1fr 1.8fr' : '1fr 1fr'),
        }}>
          {filteredSlots.map((slot) => {
            const pos = currentArea === '極上仕上場' ? getGokujoPosition(slot.label) : null;
            const isEditing = slot.editing_id !== null && slot.editing_id !== myId && !isLockExpired(slot.last_ping);
            const isHighlighted = (filterManager || filterStatus) && (!filterManager || slot.car?.carManager === filterManager) && (!filterStatus || slot.car?.status === filterStatus) && slot.car;
            const isSelected = selectedIds.includes(slot.id);
            const isMoveSrc = moveSourceId === slot.id;

            return (
              <div 
                key={slot.id} 
                onClick={() => {
                  if (isMoveMode) {
                    if (!moveSourceId && slot.car) setMoveSourceId(slot.id);
                    else if (moveSourceId) handleMove(slot.id);
                  } else if (isSelectionMode) {
                    setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id]);
                  } else { openForm(slot); }
                }}
                style={{
                  minHeight: '85px', borderRadius: '8px', border: '1px solid #ccc', padding: '5px', cursor: 'pointer', position: 'relative',
                  gridRow: pos?.row, gridColumn: pos?.col,
                  backgroundColor: isEditing ? '#ffe5e5' : (isMoveSrc ? '#ffc107' : (isSelected ? '#fff3cd' : (slot.car ? '#fff' : '#f0f0f0'))),
                  borderColor: isEditing || isSelected ? '#dc3545' : (isHighlighted ? '#007bff' : (slot.car ? '#007bff' : '#ccc')),
                  borderWidth: isHighlighted || isEditing || isSelected ? '3px' : '1px',
                  animation: isHighlighted ? 'blink 1.5s infinite' : 'none',
                  opacity: (filterManager || filterStatus) && !isHighlighted ? 0.3 : 1,
                  backgroundImage: !isEditing && slot.car?.plate === '無' ? 'linear-gradient(to bottom right, transparent 48%, rgba(220,53,69,0.4) 50%, transparent 52%)' : 'none'
                }}
              >
                <div style={{ fontSize: '10px', color: '#999', textAlign: 'center' }}>{slot.label}</div>
                {slot.car?.customerName && <div style={{ fontSize: '10px', color: '#666', textAlign: 'center' }}>{slot.car.customerName}様</div>}
                <div style={{ fontWeight: 'bold', fontSize: '11px', textAlign: 'center', marginTop: '4px' }}>{isEditing ? '入力中' : (slot.car?.name || '空')}</div>
                {slot.car?.status && <div style={{ fontSize: '10px', color: '#007bff', fontWeight: 'bold', textAlign: 'center' }}>{slot.car.status}</div>}
              </div>
            );
          })}
        </div>
      </main>

      {isSelectionMode && selectedIds.length > 0 && (
        <div style={floatingBarStyle}><span>{selectedIds.length}台 選択中</span><button onClick={handleBulkClear} style={{ backgroundColor: '#dc3545', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '5px' }}>削除実行</button></div>
      )}

      {isModalOpen && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ padding: '15px', backgroundColor: '#007bff', color: '#fff', fontWeight: 'bold' }}>車両情報入力</div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
              <input placeholder="車名" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} />
              <input placeholder="お客様名" value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} style={inputStyle} />
              <input placeholder="色" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} style={inputStyle} />
              <div style={{ display: 'flex', gap: '10px' }}>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={{...inputStyle, flex: 1}}><option value="">状況</option>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px', fontSize: '14px' }}>プレート: 
                  <label><input type="radio" checked={formData.plate === '有'} onChange={() => setFormData({...formData, plate: '有'})} />有</label>
                  <label><input type="radio" checked={formData.plate === '無'} onChange={() => setFormData({...formData, plate: '無'})} />無</label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select value={formData.carManager} onChange={e => setFormData({...formData, carManager: e.target.value})} style={{...inputStyle, flex: 1}}><option value="">車両担当</option>{STAFF_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <select value={formData.entryManager} onChange={e => setFormData({...formData, entryManager: e.target.value})} style={{...inputStyle, flex: 1}}><option value="">入庫担当</option>{STAFF_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input placeholder="入庫日" value={formData.entryDate} readOnly style={{ ...inputStyle, flex: 1, backgroundColor: '#eee' }} />
                <button onClick={() => setFormData({...formData, entryDate: getNowTimestamp()})} style={{ padding: '0 10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '5px' }}>打刻</button>
              </div>
              <textarea placeholder="備考" value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{ ...inputStyle, height: '60px' }} />
            </div>
            <div style={{ padding: '15px', display: 'flex', gap: '10px', borderTop: '1px solid #eee' }}>
              <button onClick={handleEntry} style={{ flex: 2, padding: '12px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}>保存</button>
              <button onClick={() => { setIsModalOpen(false); setTargetSlotId(null); fetchSlots(); }} style={{ flex: 1, padding: '12px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const filterSelectStyle = { flex: 1, padding: '8px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '13px' };
const navButtonStyle = { flex: 1, padding: '10px', border: 'none', borderRadius: '5px', fontWeight: 'bold' as const, fontSize: '13px' };
const inputStyle = { width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box' as const };
const modalOverlayStyle = { position: 'fixed' as const, top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContentStyle = { backgroundColor: '#fff', width: '95%', maxWidth: '450px', borderRadius: '10px', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const };
const floatingBarStyle = { position: 'fixed' as const, bottom: '20px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#fff', padding: '15px', borderRadius: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', display: 'flex', gap: '20px', alignItems: 'center', zIndex: 50 };
const loadingContainerStyle = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#fff' };
const logoWrapperStyle = { position: 'relative' as const, width: '180px' };
const logoBaseStyle = { width: '100%', height: 'auto' };
const logoColorFillStyle = { position: 'absolute' as const, top: 0, left: 0, width: '0%', height: '100%', overflow: 'hidden', animation: 'fill-color 1.5s ease-in-out forwards' };

export default App;