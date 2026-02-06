import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'

// --- 型定義 ---
interface CarDetails {
  name: string; 
  customerName: string; 
  color: string; 
  status: string; 
  plate: string;
  carManager: string; 
  entryManager: string; 
  entryDate: string; 
  memo: string;
}

interface Slot {
  id: number; 
  label: string; 
  area_name: string; // 追加
  car: CarDetails | null;
  editing_id: string | null;
  last_ping: string | null;
}

// --- 定数 ---
const AREAS = ["裏駐車場", "タワー", "極上仕上場"];

const STAFF_LIST = [
  "岡﨑 有功", "森岡 央行", "岡本 康一", "岡本 慎平", "谷本 貢一",
  "朝栄 拓海", "亀島 大夢", "淺野 佳菜子", "坪井 美佳", "杉山 詩織",
  "難波 成美", "平井 旭", "中村 俊也", "岸戸 彪我", "藤田 陸",
  "藤田 佳代", "福家 君佳", "安達 未来", "田中 美夕日", "平山 暁美",
  "松本 由香", "高下 ゆかり", "松浦 広司", "平塚 円", "坂口 達哉",
  "藤井 武司", "上山 紀昭"
];

const STATUS_LIST = [
  '売約済(小売)', '売約済(AA/業販)', '在庫', 'AA行き', '解体予定', 
  '代車', 'レンタカー', '車検預かり', '整備預かり', 'その他'
];

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
  const [currentArea, setCurrentArea] = useState(AREAS[0]); // 現在表示中の駐車場
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
        // 「裏駐車場」の時だけラベル変換ロジックを適用
        if (d.area_name === '裏駐車場' && d.label.startsWith('東-')) {
          const num = parseInt(d.label.replace('東-', ''));
          if (num >= 1 && num <= 10) displayLabel = `東-${num + 15}`;
        }
        return {
          id: d.id, label: displayLabel, area_name: d.area_name || '裏駐車場',
          editing_id: d.editing_id, last_ping: d.last_ping,
          car: d.car_name ? {
            name: d.car_name, 
            customerName: d.customer_name || '',
            color: d.color, 
            status: d.status || '',
            plate: d.plate || '有',
            carManager: d.car_manager || '',
            entryManager: d.entry_manager || '', 
            entryDate: d.entry_date, 
            memo: d.memo
          } : null
        };
      });
      setSlots(formatted);
      setTimeout(() => setLoading(false), 1800);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, () => {
        fetchSlots();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSlots]);

  useEffect(() => {
    if (!isModalOpen || !targetSlotId) return;
    const sendPing = async () => {
      await supabase.from('parking_slots').update({ last_ping: new Date().toISOString() }).eq('id', targetSlotId);
    };
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

  // --- フィルタリングされたスロット ---
  const filteredSlots = useMemo(() => {
    return slots.filter(s => s.area_name === currentArea);
  }, [slots, currentArea]);

  const handleMove = async (toId: number) => {
    const sourceSlot = slots.find(s => s.id === moveSourceId);
    if (!sourceSlot || !sourceSlot.car) return;
    await supabase.from('parking_slots').update({
      car_name: sourceSlot.car.name, customer_name: sourceSlot.car.customerName, color: sourceSlot.car.color, status: sourceSlot.car.status,
      plate: sourceSlot.car.plate, car_manager: sourceSlot.car.carManager,
      entry_manager: sourceSlot.car.entryManager, entry_date: sourceSlot.car.entryDate,
      memo: sourceSlot.car.memo, editing_id: null, last_ping: null
    }).eq('id', toId);
    await supabase.from('parking_slots').update({
      car_name: null, customer_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null, editing_id: null, last_ping: null
    }).eq('id', moveSourceId);
    setMoveSourceId(null);
    fetchSlots();
  };

  const handlePlacePooledCar = async (toId: number) => {
    if (!pooledCar) return;
    await supabase.from('parking_slots').update({
      car_name: pooledCar.name, customer_name: pooledCar.customerName, color: pooledCar.color, status: pooledCar.status,
      plate: pooledCar.plate, car_manager: pooledCar.carManager,
      entry_manager: pooledCar.entryManager, entry_date: pooledCar.entryDate,
      memo: pooledCar.memo, editing_id: null, last_ping: null
    }).eq('id', toId);
    setPooledCar(null);
    fetchSlots();
  };

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

  const closeModal = async () => {
    if (targetSlotId) await supabase.from('parking_slots').update({ editing_id: null, last_ping: null }).eq('id', targetSlotId);
    setIsModalOpen(false); setTargetSlotId(null); fetchSlots();
  };

  const handleEntry = async () => {
    if (!targetSlotId) return;
    await supabase.from('parking_slots').update({
      car_name: formData.name, customer_name: formData.customerName, color: formData.color, status: formData.status,
      plate: formData.plate, car_manager: formData.carManager,
      entry_manager: formData.entryManager, entry_date: formData.entryDate, memo: formData.memo,
      editing_id: null, last_ping: null
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

  if (loading) return (
    <div style={loadingContainerStyle}>
      <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333', letterSpacing: '3px' }}>LOADING</div>
    </div>
  );

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', width: '100%', fontFamily: 'sans-serif', margin: 0, padding: 0 }}>
      <div style={{ backgroundColor: '#fff', padding: '15px 0', position: 'relative', borderBottom: '1px solid #eee' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 'bold', textAlign: 'center', margin: 0 }}>🚗 駐車場管理システム</h1>
        <button onClick={handleForceUnlockAll} style={forceUnlockButtonStyle}>⚙</button>
      </div>

      {/* 駐車場切り替えタブ */}
      <div style={{ display: 'flex', backgroundColor: '#fff', padding: '10px', gap: '5px', overflowX: 'auto', borderBottom: '1px solid #ddd' }}>
        {AREAS.map(area => (
          <button 
            key={area}
            onClick={() => { setCurrentArea(area); setSelectedIds([]); setMoveSourceId(null); setPooledCar(null); }}
            style={{
              padding: '10px 15px', borderRadius: '20px', border: '1px solid #ddd', whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 'bold',
              backgroundColor: currentArea === area ? '#007bff' : '#f8f9fa',
              color: currentArea === area ? '#fff' : '#333'
            }}
          >
            {area}
          </button>
        ))}
      </div>

      <div style={{ position: 'sticky', top: 0, backgroundColor: '#ffffff', borderBottom: '1px solid #ddd', zIndex: 1000, padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', maxWidth: '600px', margin: '0 auto 12px auto' }}>
          <select value={filterManager} onChange={(e) => setFilterManager(e.target.value)} style={filterSelectStyle}>
            <option value="">担当者で絞り込み</option>
            {STAFF_LIST.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={filterSelectStyle}>
            <option value="">状況で絞り込み</option>
            {STATUS_LIST.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <button onClick={resetFilters} style={resetButtonStyle}>解除</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', maxWidth: '600px', margin: '0 auto' }}>
          <button onClick={() => { setIsSelectionMode(false); setIsMoveMode(false); setSelectedIds([]); setMoveSourceId(null); setPooledCar(null); }} style={{ ...navButtonStyle, backgroundColor: (!isSelectionMode && !isMoveMode) ? '#007bff' : '#f8f9fa', color: (!isSelectionMode && !isMoveMode) ? '#fff' : '#333' }}>入力</button>
          <button onClick={() => { setIsSelectionMode(false); setIsMoveMode(true); setSelectedIds([]); setMoveSourceId(null); }} style={{ ...navButtonStyle, backgroundColor: isMoveMode ? '#ffc107' : '#f8f9fa', color: '#000' }}>移動</button>
          <button onClick={() => { setIsSelectionMode(true); setIsMoveMode(false); setMoveSourceId(null); setPooledCar(null); }} style={{ ...navButtonStyle, backgroundColor: isSelectionMode ? '#dc3545' : '#f8f9fa', color: isSelectionMode ? '#fff' : '#333' }}>削除</button>
        </div>
      </div>

      <div style={{ maxWidth: '950px', margin: '0 auto', padding: '20px 10px 180px 10px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))', gap: '8px' }}>
          {filteredSlots.map((slot) => {
            const isEditing = slot.editing_id !== null && slot.editing_id !== myId && !isLockExpired(slot.last_ping);
            const isMoveSource = moveSourceId === slot.id;
            const isSelected = selectedIds.includes(slot.id);
            
            const matchManager = filterManager === '' || slot.car?.carManager === filterManager;
            const matchStatus = filterStatus === '' || slot.car?.status === filterStatus;
            const isHighlighted = (filterManager !== '' || filterStatus !== '') && matchManager && matchStatus && slot.car;

            const diagonalStyle = !isEditing && slot.car?.plate === '無' 
              ? { backgroundImage: 'linear-gradient(to bottom right, transparent calc(50% - 2px), rgba(220, 53, 69, 0.4) 50%, transparent calc(50% + 2px))' }
              : {};

            return (
              <div 
                key={slot.id} 
                onClick={() => {
                  if (isMoveMode) {
                    if (pooledCar) handlePlacePooledCar(slot.id);
                    else if (!moveSourceId && slot.car) setMoveSourceId(slot.id);
                    else if (moveSourceId) {
                       if (moveSourceId === slot.id) setMoveSourceId(null);
                       else handleMove(slot.id);
                    }
                  } else if (isSelectionMode) {
                    setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id]);
                  } else { openForm(slot); }
                }}
                style={{
                  minHeight: '85px', borderRadius: '8px', border: '1px solid #ccc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '4px', position: 'relative',
                  backgroundColor: isEditing ? '#ffe5e5' : (isHighlighted ? '#e3f2fd' : (isMoveSource ? '#ffc107' : (isSelected ? '#fff3cd' : (slot.car ? '#fff' : '#f0f0f0')))),
                  borderColor: isEditing ? '#dc3545' : (isHighlighted ? '#007bff' : (isMoveSource ? '#ff9800' : (isSelected ? '#dc3545' : (slot.car ? '#007bff' : '#ccc')))),
                  borderWidth: (isMoveSource || isSelected || isEditing || isHighlighted) ? '3px' : '1px',
                  ...diagonalStyle
                }}
              >
                <span style={{ fontSize: '9px', color: '#888', marginBottom: '2px', position: 'relative', zIndex: 1 }}>{slot.label}</span>
                {slot.car?.customerName && <span style={{ fontSize: '9px', color: '#666', lineHeight: '1', position: 'relative', zIndex: 1 }}>{slot.car.customerName} 様</span>}
                <span style={{ fontWeight: 'bold', fontSize: '12px', textAlign: 'center', color: isEditing ? '#dc3545' : '#333', lineHeight: '1.2', position: 'relative', zIndex: 1 }}>
                  {isEditing ? '入力中' : (slot.car?.name || '空')}
                </span>
                {!isEditing && slot.car && <span style={{ color: '#007bff', fontSize: '9px', fontWeight: 'bold', marginTop: '2px', position: 'relative', zIndex: 1 }}>{slot.car.status}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {isSelectionMode && selectedIds.length > 0 && (
        <div style={floatingBarStyle}>
          <span style={{ fontWeight: 'bold' }}>{selectedIds.length}台 選択</span>
          <button onClick={() => handleBulkClear()} style={bulkDeleteButtonStyle}>削除実行</button>
        </div>
      )}

      {/* 一時保管バー（移動モード用） */}
      {isMoveMode && pooledCar && (
        <div style={poolBarStyle}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', color: '#666' }}>一時保管中 (移動先をタップ)</div>
            <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{pooledCar.name}</div>
          </div>
          <button onClick={() => setPooledCar(null)} style={poolDeleteButtonStyle}>取消</button>
        </div>
      )}

      {isModalOpen && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ padding: '15px 20px', borderBottom: '2px solid #007bff', backgroundColor: '#fff' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>車両情報:[{slots.find(s => s.id === targetSlotId)?.label}]</h2>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 車名</span><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} /></div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ お客様名</span><input type="text" value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} style={inputStyle} placeholder="様" /></div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 色</span><input type="text" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} style={inputStyle} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 状況</span>
                  <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={inputStyle}>
                    <option value=""></option>
                    {STATUS_LIST.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div style={fieldGroupStyle}>
                  <span style={labelStyle}>◻︎ プレート</span>
                  <div style={{ display: 'flex', gap: '20px', padding: '10px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" name="plate" value="有" checked={formData.plate === '有'} onChange={e => setFormData({...formData, plate: e.target.value})} /> 有</label>
                    <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" name="plate" value="無" checked={formData.plate === '無'} onChange={e => setFormData({...formData, plate: e.target.value})} /> 無</label>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 車両担当</span>
                  <select value={formData.carManager} onChange={e => setFormData({...formData, carManager: e.target.value})} style={inputStyle}>
                    <option value=""></option>
                    {STAFF_LIST.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 入庫担当</span>
                  <select value={formData.entryManager} onChange={e => setFormData({...formData, entryManager: e.target.value})} style={inputStyle}>
                    <option value=""></option>
                    {STAFF_LIST.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
              </div>
              <div style={fieldGroupStyle}>
                <span style={labelStyle}>◻︎ 入庫日</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" value={formData.entryDate} readOnly style={{ ...inputStyle, backgroundColor: '#f0f0f0', flex: 1 }} />
                  <button onClick={() => setFormData({...formData, entryDate: getNowTimestamp()})} style={{ backgroundColor: '#28a745', color: '#fff', border: 'none', padding: '0 12px', borderRadius: '6px' }}>打刻</button>
                </div>
              </div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 備考</span><textarea rows={2} value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{...inputStyle, height: '60px'}} /></div>
            </div>
            <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
              <button onClick={handleEntry} style={{ flex: 2, padding: '14px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px' }}>保存する</button>
              <button onClick={closeModal} style={{ flex: 1, padding: '14px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- スタイル定義 ---
const loadingContainerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#fff' };
const filterSelectStyle = { flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '13px', backgroundColor: '#f8f9fa' };
const resetButtonStyle = { padding: '0 15px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px' };
const navButtonStyle = { flex: 1, padding: '12px 0', border: '1px solid #ddd', borderRadius: '8px', fontWeight: 'bold' as const, fontSize: '13px' };
const forceUnlockButtonStyle = { position: 'absolute' as const, right: '15px', top: '50%', transform: 'translateY(-50%)', border: 'none', backgroundColor: 'transparent', color: '#ddd', fontSize: '18px' };
const floatingBarStyle = { position: 'fixed' as const, bottom: '25px', left: '50%', transform: 'translateX(-50%)', width: '92%', maxWidth: '400px', backgroundColor: '#fff', padding: '15px', borderRadius: '15px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2000, border: '1px solid #dc3545' };
const bulkDeleteButtonStyle = { backgroundColor: '#dc3545', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold' };
const poolBarStyle = { position: 'fixed' as const, bottom: '25px', left: '50%', transform: 'translateX(-50%)', width: '92%', maxWidth: '400px', backgroundColor: '#e3f2fd', padding: '15px', borderRadius: '15px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2000, border: '2px solid #2196f3' };
const poolDeleteButtonStyle = { backgroundColor: '#666', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold' };
const modalOverlayStyle = { position: 'fixed' as const, top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '10px' };
const modalContentStyle = { backgroundColor: '#fff', width: '100%', maxWidth: '450px', borderRadius: '15px', maxHeight: '95vh', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' };
const fieldGroupStyle = { display: 'flex', flexDirection: 'column' as const, gap: '4px' };
const labelStyle = { fontSize: '13px', fontWeight: 'bold' as const, color: '#444' };
const inputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px', boxSizing: 'border-box' as const };

export default App;