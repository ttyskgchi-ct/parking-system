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

  const isLockExpired = (lastPing: string | null) => {
    if (!lastPing) return true;
    const last = new Date(lastPing).getTime();
    const now = new Date().getTime();
    return (now - last) > 5 * 60 * 1000;
  };

  const fetchSlots = useCallback(async () => {
    const { data, error } = await supabase.from('parking_slots').select('*').order('id', { ascending: true });
    if (!error && data) {
      const formatted: Slot[] = data.map(d => {
        let displayLabel = d.label;
        if (d.area_name === '裏駐車場' && d.label.startsWith('東-')) {
          const num = parseInt(d.label.replace('東-', ''));
          if (num >= 1 && num <= 10) displayLabel = `東-${num + 15}`;
        }
        return {
          id: d.id, label: displayLabel, area_name: d.area_name || '裏駐車場',
          editing_id: d.editing_id, last_ping: d.last_ping,
          car: d.car_name ? {
            name: d.car_name, customerName: d.customer_name || '', color: d.color, status: d.status || '',
            plate: d.plate || '有', carManager: d.car_manager || '', entryManager: d.entry_manager || '', 
            entryDate: d.entry_date, memo: d.memo
          } : null
        };
      });
      setSlots(formatted);
      setTimeout(() => setLoading(false), 800);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    const channel = supabase.channel('schema-db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, () => fetchSlots()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSlots]);

  useEffect(() => {
    if (!isModalOpen || !targetSlotId) return;
    const sendPing = async () => { await supabase.from('parking_slots').update({ last_ping: new Date().toISOString() }).eq('id', targetSlotId); };
    sendPing();
    const interval = setInterval(sendPing, 30000);
    return () => clearInterval(interval);
  }, [isModalOpen, targetSlotId]);

  const getNowTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}/${(now.getMonth()+1)}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
  };

  const handleForceUnlockAll = async () => {
    if (!confirm('全ての「入力中」状態を強制解除しますか？')) return;
    await supabase.from('parking_slots').update({ editing_id: null, last_ping: null }).not('editing_id', 'is', null);
    fetchSlots();
  };

  const resetFilters = () => { setFilterManager(''); setFilterStatus(''); };

  const displaySlots = useMemo(() => {
    return slots.filter(s => s.area_name === currentArea);
  }, [slots, currentArea]);

  const handleMove = async (toId: number) => {
    const src = slots.find(s => s.id === moveSourceId);
    if (!src || !src.car) return;
    await supabase.from('parking_slots').update({
      car_name: src.car.name, customer_name: src.car.customerName, color: src.car.color, status: src.car.status,
      plate: src.car.plate, car_manager: src.car.carManager, entry_manager: src.car.entryManager, 
      entry_date: src.car.entryDate, memo: src.car.memo, editing_id: null, last_ping: null
    }).eq('id', toId);
    await supabase.from('parking_slots').update({ car_name: null, customer_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null, editing_id: null, last_ping: null }).eq('id', moveSourceId);
    setMoveSourceId(null); fetchSlots();
  };

  const handlePlacePooledCar = async (toId: number) => {
    if (!pooledCar) return;
    await supabase.from('parking_slots').update({ 
      car_name: pooledCar.name, customer_name: pooledCar.customerName, color: pooledCar.color, status: pooledCar.status,
      plate: pooledCar.plate, car_manager: pooledCar.carManager, entry_manager: pooledCar.entryManager, 
      entry_date: pooledCar.entryDate, memo: pooledCar.memo, editing_id: null, last_ping: null 
    }).eq('id', toId);
    setPooledCar(null); fetchSlots();
  };

  const openForm = async (slot: Slot) => {
    const isLocked = slot.editing_id && !isLockExpired(slot.last_ping);
    if (isLocked && slot.editing_id !== myId) {
       if(!confirm('他の方が入力中ですが、強制的に編集を開始しますか？')) return;
    }
    await supabase.from('parking_slots').update({ editing_id: myId, last_ping: new Date().toISOString() }).eq('id', slot.id);
    setTargetSlotId(slot.id); setFormData(slot.car || initialFormData); setIsModalOpen(true);
  };

  const closeModal = async () => {
    if (targetSlotId) await supabase.from('parking_slots').update({ editing_id: null, last_ping: null }).eq('id', targetSlotId);
    setIsModalOpen(false); setTargetSlotId(null); fetchSlots();
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

  const handleBulkClear = async () => {
    if (!confirm(`${selectedIds.length}台を削除しますか？`)) return;
    await supabase.from('parking_slots').update({ 
      car_name: null, customer_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null, editing_id: null, last_ping: null
    }).in('id', selectedIds);
    setSelectedIds([]); setIsSelectionMode(false); fetchSlots();
  };

  const renderSlot = (slot: Slot) => {
    const isEditing = slot.editing_id !== null && slot.editing_id !== myId && !isLockExpired(slot.last_ping);
    const isMoveSource = moveSourceId === slot.id;
    const isSelected = selectedIds.includes(slot.id);
    const isHighlighted = (filterManager || filterStatus) && (!filterManager || slot.car?.carManager === filterManager) && (!filterStatus || slot.car?.status === filterStatus) && slot.car;

    const diagonalStyle = !isEditing && slot.car?.plate === '無' 
      ? { backgroundImage: 'linear-gradient(to bottom right, transparent calc(50% - 2px), rgba(220, 53, 69, 0.4) 50%, transparent calc(50% + 2px))' }
      : {};

    let bgColor = '#f0f0f0';
    if (isEditing) bgColor = '#ffe5e5';
    else if (isMoveSource) bgColor = '#ffc107';
    else if (isSelected) bgColor = '#fff3cd';
    else if (isHighlighted) bgColor = '#e3f2fd';
    else if (slot.car) bgColor = '#fff';

    return (
      <div key={slot.id} 
        onClick={() => {
          if (isMoveMode) {
            if (pooledCar) handlePlacePooledCar(slot.id);
            else if (!moveSourceId && slot.car) setMoveSourceId(slot.id);
            else if (moveSourceId) (moveSourceId === slot.id) ? setMoveSourceId(null) : handleMove(slot.id);
          } else if (isSelectionMode) {
            setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id]);
          } else { openForm(slot); }
        }}
        style={{
          minHeight: '85px', borderRadius: '8px', border: '1px solid #ccc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '4px', position: 'relative',
          backgroundColor: bgColor,
          borderColor: isEditing ? '#dc3545' : (isMoveSource ? '#ff9800' : (isSelected ? '#dc3545' : (isHighlighted ? '#007bff' : (slot.car ? '#007bff' : '#ccc')))),
          borderWidth: (isMoveSource || isSelected || isEditing || isHighlighted) ? '3px' : '1px',
          opacity: (filterManager || filterStatus) && !isHighlighted ? 0.3 : 1,
          ...diagonalStyle
        }}
      >
        <span style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>{slot.label}</span>
        {slot.car?.customerName && <span style={{ fontSize: '10px', color: '#666', lineHeight: '1' }}>{slot.car.customerName} 様</span>}
        <span style={{ fontWeight: 'bold', fontSize: '13px', textAlign: 'center', color: isEditing ? '#dc3545' : '#333' }}>
          {isEditing ? '入力中' : (slot.car?.name || '空')}
        </span>
        {!isEditing && slot.car && <span style={{ color: '#007bff', fontSize: '10px', fontWeight: 'bold', marginTop: '2px' }}>{slot.car.status}</span>}
      </div>
    );
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>読み込み中...</div>;

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', width: '100%', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: '#fff', padding: '15px 0', textAlign: 'center', borderBottom: '1px solid #eee' }}>
        <h1 style={{ fontSize: '20px', margin: 0 }}>🚗 拠点別駐車場管理</h1>
      </div>

      <div style={{ display: 'flex', padding: '10px', gap: '8px', justifyContent: 'center', backgroundColor: '#fff' }}>
        {AREAS.map(area => (
          <button key={area} onClick={() => { setCurrentArea(area); setSelectedIds([]); setMoveSourceId(null); }} 
            style={{ padding: '8px 20px', borderRadius: '20px', border: '1px solid #ddd', backgroundColor: currentArea === area ? '#007bff' : '#f8f9fa', color: currentArea === area ? '#fff' : '#333' }}>
            {area}
          </button>
        ))}
      </div>

      <div style={{ position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#fff', padding: '10px', borderBottom: '1px solid #ddd' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '10px' }}>
          <select value={filterManager} onChange={e => setFilterManager(e.target.value)} style={filterSelectStyle}><option value="">担当者</option>{STAFF_LIST.map(n => <option key={n} value={n}>{n}</option>)}</select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={filterSelectStyle}><option value="">状況</option>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <button onClick={resetFilters} style={resetButtonStyle}>解除</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <button onClick={() => {setIsMoveMode(false); setIsSelectionMode(false);}} style={{...navButtonStyle, backgroundColor: (!isMoveMode && !isSelectionMode) ? '#007bff' : '#eee', color: (!isMoveMode && !isSelectionMode) ? '#fff' : '#333'}}>入力</button>
          <button onClick={() => {setIsMoveMode(true); setIsSelectionMode(false);}} style={{...navButtonStyle, backgroundColor: isMoveMode ? '#ffc107' : '#eee'}}>移動</button>
          <button onClick={() => {setIsSelectionMode(true); setIsMoveMode(false);}} style={{...navButtonStyle, backgroundColor: isSelectionMode ? '#dc3545' : '#eee', color: isSelectionMode ? '#fff' : '#333'}}>削除</button>
        </div>
      </div>

      <div style={{ maxWidth: '950px', margin: '0 auto', padding: '20px 10px 150px 10px' }}>
        {currentArea === '極上仕上場' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            {[
              { label: "東エリア (4列)", keyword: "東", cols: 4 },
              { label: "西エリア (2列)", keyword: "西", cols: 2 },
              { label: "ポート", keyword: "ポート", cols: 3 },
              { label: "スタジオ / 掃除スペース", keyword: ["スタジオ", "掃除スペース"], cols: 2 },
              { label: "予備", keyword: "予備", cols: 4 }
            ].map(section => {
              const sectionSlots = displaySlots
                .filter(s => 
                  Array.isArray(section.keyword) 
                    ? section.keyword.some(k => s.label.includes(k)) 
                    : s.label.includes(section.keyword)
                )
                .sort((a, b) => a.label.localeCompare(b.label, 'ja', {numeric: true}));
              
              if (sectionSlots.length === 0) return null;
              return (
                <div key={section.label}>
                  <h3 style={{ borderLeft: '5px solid #007bff', paddingLeft: '10px', fontSize: '16px', marginBottom: '10px' }}>{section.label}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${section.cols}, 1fr)`, gap: '10px' }}>
                    {sectionSlots.map(slot => renderSlot(slot))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: currentArea === '裏駐車場' ? '1.8fr 1fr 1fr 1fr 1.8fr' : '1fr 1fr', gap: '12px' }}>
            {displaySlots.map(slot => renderSlot(slot))}
          </div>
        )}
      </div>

      {isSelectionMode && selectedIds.length > 0 && (
        <div style={floatingBarStyle}>
          <span>{selectedIds.length}台 選択中</span>
          <button onClick={handleBulkClear} style={bulkDeleteButtonStyle}>削除実行</button>
        </div>
      )}

      {isModalOpen && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ padding: '15px', borderBottom: '1px solid #ddd' }}>
              <b>{slots.find(s => s.id === targetSlotId)?.label} 情報入力</b>
            </div>
            <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
              <input type="text" placeholder="車名" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} />
              <input type="text" placeholder="お客様名" value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} style={inputStyle} />
              <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={inputStyle}>
                <option value="">状況を選択</option>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select value={formData.carManager} onChange={e => setFormData({...formData, carManager: e.target.value})} style={{...inputStyle, flex: 1}}><option value="">担当</option>{STAFF_LIST.map(n => <option key={n} value={n}>{n}</option>)}</select>
                <button onClick={() => setFormData({...formData, entryDate: getNowTimestamp()})} style={{ padding: '10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '5px' }}>入庫打刻</button>
              </div>
              <textarea placeholder="備考" value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{...inputStyle, height: '60px'}} />
            </div>
            <div style={{ padding: '15px', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
              <button onClick={handleEntry} style={{ flex: 1, padding: '12px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '5px', fontWeight: 'bold' }}>保存</button>
              <button onClick={closeModal} style={{ flex: 1, padding: '12px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '5px' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const filterSelectStyle = { flex: 1, padding: '8px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '13px' };
const resetButtonStyle = { padding: '0 10px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '5px' };
const navButtonStyle = { flex: 1, padding: '10px', border: 'none', borderRadius: '5px', fontWeight: 'bold' as const };
const inputStyle = { padding: '12px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '16px' };
const modalOverlayStyle = { position: 'fixed' as const, top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContentStyle = { backgroundColor: '#fff', width: '90%', maxWidth: '400px', borderRadius: '10px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const };
const floatingBarStyle = { position: 'fixed' as const, bottom: '20px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#fff', padding: '15px', borderRadius: '30px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '20px', zIndex: 500 };
const bulkDeleteButtonStyle = { backgroundColor: '#dc3545', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '20px', fontWeight: 'bold' };

export default App;