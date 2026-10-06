/* HalalCheck knowledge base — part 3: INS / E-number additive codes and phrase cards.
 * codes[code] = [name_zh, name_en, status, note]
 * Chinese labels write codes as 乳化剂(471)、增稠剂(407,412) or E471 / INS 471. Status vocabulary as in db.js.
 */
(function (DB) {
  var C = DB.codes;
  var set = function (code, zh, en, s, n) { C[code] = [zh, en, s, n || '']; };
  // colours
  set('100', '姜黄素', 'curcumin', 'ok'); set('101', '核黄素', 'riboflavin', 'ok'); set('102', '柠檬黄', 'tartrazine', 'ok'); set('104', '喹啉黄', 'quinoline yellow', 'ok');
  set('110', '日落黄', 'sunset yellow', 'ok');
  set('120', '胭脂虫红', 'carmine / cochineal (insect)', 'doubtful', 'Insect-derived: impermissible in Shafi\'i and Hanafi law; permitted by Indonesia\'s MUI.');
  set('122', '偶氮玉红', 'azorubine', 'ok'); set('123', '苋菜红', 'amaranth', 'ok'); set('124', '胭脂红', 'Ponceau 4R (synthetic)', 'ok', 'Synthetic — not the insect carmine E120.');
  set('127', '赤藓红', 'erythrosine', 'ok'); set('129', '诱惑红', 'allura red', 'ok'); set('131', '专利蓝', 'patent blue', 'ok'); set('132', '靛蓝', 'indigotine', 'ok');
  set('133', '亮蓝', 'brilliant blue', 'ok'); set('140', '叶绿素', 'chlorophyll', 'ok'); set('141', '叶绿素铜钠盐', 'copper chlorophyllin', 'ok'); set('142', '绿色S', 'green S', 'ok');
  set('150a', '焦糖色', 'plain caramel', 'ok'); set('150b', '焦糖色', 'caustic sulfite caramel', 'ok'); set('150c', '焦糖色', 'ammonia caramel', 'ok'); set('150d', '焦糖色', 'sulfite ammonia caramel', 'ok');
  set('150', '焦糖色', 'caramel colour', 'ok'); set('151', '亮黑', 'brilliant black', 'ok'); set('153', '植物炭黑', 'vegetable carbon', 'ok', 'Fine when plant-derived (植物炭黑); bone char would be doubtful.');
  set('155', '棕色HT', 'brown HT', 'ok'); set('160a', 'β-胡萝卜素', 'beta-carotene', 'ok'); set('160b', '胭脂树橙', 'annatto', 'ok'); set('160c', '辣椒红', 'paprika extract', 'ok');
  set('160d', '番茄红素', 'lycopene', 'ok'); set('160e', 'β-阿朴-8′-胡萝卜素醛', 'beta-apo-8-carotenal', 'ok'); set('161b', '叶黄素', 'lutein', 'ok'); set('161g', '斑蝥黄', 'canthaxanthin', 'ok');
  set('162', '甜菜红', 'beet red', 'ok'); set('163', '花青素', 'anthocyanins', 'ok'); set('170', '碳酸钙', 'calcium carbonate', 'ok'); set('171', '二氧化钛', 'titanium dioxide', 'ok');
  set('172', '氧化铁', 'iron oxides', 'ok'); set('173', '铝', 'aluminium', 'ok'); set('174', '银', 'silver', 'ok'); set('175', '金', 'gold', 'ok');
  // preservatives
  set('200', '山梨酸', 'sorbic acid', 'ok'); set('201', '山梨酸钠', 'sodium sorbate', 'ok'); set('202', '山梨酸钾', 'potassium sorbate', 'ok'); set('203', '山梨酸钙', 'calcium sorbate', 'ok');
  set('210', '苯甲酸', 'benzoic acid', 'ok'); set('211', '苯甲酸钠', 'sodium benzoate', 'ok'); set('212', '苯甲酸钾', 'potassium benzoate', 'ok'); set('213', '苯甲酸钙', 'calcium benzoate', 'ok');
  set('214', '对羟基苯甲酸乙酯', 'ethyl paraben', 'ok'); set('218', '对羟基苯甲酸甲酯', 'methyl paraben', 'ok'); set('220', '二氧化硫', 'sulfur dioxide', 'ok'); set('221', '亚硫酸钠', 'sodium sulfite', 'ok');
  set('222', '亚硫酸氢钠', 'sodium bisulfite', 'ok'); set('223', '焦亚硫酸钠', 'sodium metabisulfite', 'ok'); set('224', '焦亚硫酸钾', 'potassium metabisulfite', 'ok'); set('228', '亚硫酸氢钾', 'potassium bisulfite', 'ok');
  set('234', '乳酸链球菌素', 'nisin', 'ok'); set('235', '纳他霉素', 'natamycin', 'ok'); set('239', '六亚甲基四胺', 'hexamethylene tetramine', 'ok'); set('242', '二甲基二碳酸盐', 'dimethyl dicarbonate', 'ok');
  set('249', '亚硝酸钾', 'potassium nitrite', 'ok'); set('250', '亚硝酸钠', 'sodium nitrite', 'ok', 'Curing salt — fine itself; the cured meat is the question.'); set('251', '硝酸钠', 'sodium nitrate', 'ok'); set('252', '硝酸钾', 'potassium nitrate', 'ok');
  set('260', '乙酸', 'acetic acid', 'ok'); set('261', '乙酸钾', 'potassium acetate', 'ok'); set('262', '乙酸钠', 'sodium acetate', 'ok'); set('263', '乙酸钙', 'calcium acetate', 'ok');
  set('270', '乳酸', 'lactic acid', 'ok'); set('280', '丙酸', 'propionic acid', 'ok'); set('281', '丙酸钠', 'sodium propionate', 'ok'); set('282', '丙酸钙', 'calcium propionate', 'ok');
  set('290', '二氧化碳', 'carbon dioxide', 'ok'); set('296', '苹果酸', 'malic acid', 'ok'); set('297', '富马酸', 'fumaric acid', 'ok');
  // antioxidants, acidity regulators
  set('300', '抗坏血酸', 'ascorbic acid', 'ok'); set('301', '抗坏血酸钠', 'sodium ascorbate', 'ok'); set('302', '抗坏血酸钙', 'calcium ascorbate', 'ok');
  set('304', '抗坏血酸棕榈酸酯', 'ascorbyl palmitate', 'caution', 'Palmitic acid is normally palm-derived; animal source possible but rare.');
  set('306', '混合生育酚', 'mixed tocopherols', 'ok'); set('307', 'α-生育酚', 'alpha-tocopherol', 'ok'); set('310', '没食子酸丙酯', 'propyl gallate', 'ok'); set('319', 'TBHQ', 'TBHQ', 'ok');
  set('320', 'BHA', 'BHA', 'ok'); set('321', 'BHT', 'BHT', 'ok'); set('322', '卵磷脂', 'lecithin (soy or egg)', 'ok'); set('325', '乳酸钠', 'sodium lactate', 'ok'); set('326', '乳酸钾', 'potassium lactate', 'ok');
  set('327', '乳酸钙', 'calcium lactate', 'ok'); set('330', '柠檬酸', 'citric acid', 'ok'); set('331', '柠檬酸钠', 'sodium citrates', 'ok'); set('332', '柠檬酸钾', 'potassium citrates', 'ok');
  set('333', '柠檬酸钙', 'calcium citrates', 'ok'); set('334', '酒石酸', 'tartaric acid', 'ok', 'Not alcohol.'); set('335', '酒石酸钠', 'sodium tartrates', 'ok'); set('336', '酒石酸钾', 'potassium tartrates', 'ok');
  set('337', '酒石酸钾钠', 'potassium sodium tartrate', 'ok'); set('338', '磷酸', 'phosphoric acid', 'ok'); set('339', '磷酸钠', 'sodium phosphates', 'ok'); set('340', '磷酸钾', 'potassium phosphates', 'ok');
  set('341', '磷酸钙', 'calcium phosphates', 'ok'); set('343', '磷酸镁', 'magnesium phosphates', 'ok'); set('350', '苹果酸钠', 'sodium malates', 'ok'); set('351', '苹果酸钾', 'potassium malate', 'ok');
  set('352', '苹果酸钙', 'calcium malates', 'ok'); set('355', '己二酸', 'adipic acid', 'ok'); set('363', '琥珀酸', 'succinic acid', 'ok'); set('380', '柠檬酸铵', 'triammonium citrate', 'ok');
  set('385', 'EDTA二钠钙', 'calcium disodium EDTA', 'ok'); set('386', 'EDTA二钠', 'disodium EDTA', 'ok');
  // thickeners, emulsifiers
  set('400', '海藻酸', 'alginic acid', 'ok'); set('401', '海藻酸钠', 'sodium alginate', 'ok'); set('402', '海藻酸钾', 'potassium alginate', 'ok'); set('403', '海藻酸铵', 'ammonium alginate', 'ok');
  set('404', '海藻酸钙', 'calcium alginate', 'ok'); set('405', '海藻酸丙二醇酯', 'propylene glycol alginate', 'ok'); set('406', '琼脂', 'agar', 'ok'); set('407', '卡拉胶', 'carrageenan', 'ok');
  set('407a', '加工海藻', 'processed eucheuma seaweed', 'ok'); set('410', '刺槐豆胶', 'locust bean gum', 'ok'); set('412', '瓜尔胶', 'guar gum', 'ok'); set('413', '黄蓍胶', 'tragacanth', 'ok');
  set('414', '阿拉伯胶', 'gum arabic', 'ok'); set('415', '黄原胶', 'xanthan gum', 'ok'); set('416', '刺梧桐胶', 'karaya gum', 'ok'); set('417', '塔拉胶', 'tara gum', 'ok'); set('418', '结冷胶', 'gellan gum', 'ok');
  set('420', '山梨糖醇', 'sorbitol', 'ok'); set('421', '甘露糖醇', 'mannitol', 'ok');
  set('422', '甘油', 'glycerol', 'caution', 'May be animal- or plant-derived.');
  set('424', '可得然胶', 'curdlan', 'ok'); set('425', '魔芋胶', 'konjac', 'ok'); set('426', '大豆多糖', 'soybean hemicellulose', 'ok');
  set('428', '明胶', 'gelatin', 'likely', 'Source unstated — in China almost always pig skin or non-halal-slaughtered cattle.');
  set('440', '果胶', 'pectin', 'ok');
  set('441', '明胶 (E441) / 氢化菜籽油 (INS 441)', 'E441 gelatin in older European labelling; INS 441 (Codex, China) is hydrogenated rapeseed oil', 'doubtful', 'Ambiguous number: on a European-style label E441 means gelatin (then treat as likely non-halal); under the Codex/China INS list 441 is a plant-based rapeseed emulsifier. Gelatin\'s Codex number is 428.');
  set('442', '磷脂酸铵盐', 'ammonium phosphatides', 'caution', 'Fatty-acid source unverifiable; usually rapeseed.');
  set('444', '蔗糖乙酸异丁酸酯', 'sucrose acetate isobutyrate', 'ok'); set('445', '松香甘油酯', 'glycerol esters of wood rosin', 'ok'); set('450', '焦磷酸盐', 'diphosphates', 'ok');
  set('451', '三磷酸盐', 'triphosphates', 'ok'); set('452', '聚磷酸盐', 'polyphosphates', 'ok'); set('459', 'β-环状糊精', 'beta-cyclodextrin', 'ok'); set('460', '纤维素', 'cellulose', 'ok');
  set('461', '甲基纤维素', 'methyl cellulose', 'ok'); set('463', '羟丙基纤维素', 'hydroxypropyl cellulose', 'ok'); set('464', '羟丙基甲基纤维素', 'HPMC', 'ok'); set('466', '羧甲基纤维素钠', 'sodium CMC', 'ok');
  set('470', '脂肪酸盐', 'salts of fatty acids', 'caution', 'Fatty-acid source may be animal or plant.'); set('470a', '脂肪酸钠/钾/钙', 'sodium, potassium, calcium salts of fatty acids', 'caution', 'Fatty-acid source may be animal or plant.');
  set('470b', '脂肪酸镁', 'magnesium salts of fatty acids', 'caution', 'Fatty-acid source may be animal or plant.');
  set('471', '单，双甘油脂肪酸酯', 'mono- and diglycerides of fatty acids', 'caution', 'Fat may be animal (including pork) or plant; in China mostly palm-based but unverifiable.');
  set('472a', '乙酰化单甘油脂肪酸酯', 'acetic acid esters of glycerides', 'caution', 'Fat source unverifiable.'); set('472b', '乳酸脂肪酸甘油酯', 'lactic acid esters of glycerides', 'caution', 'Fat source unverifiable.');
  set('472c', '柠檬酸脂肪酸甘油酯', 'citric acid esters of glycerides', 'caution', 'Fat source unverifiable.'); set('472e', '双乙酰酒石酸单双甘油酯', 'DATEM', 'caution', 'Fat source unverifiable; no alcohol.');
  set('472', '甘油脂肪酸酯衍生物', 'esters of glycerides', 'caution', 'Fat source unverifiable.');
  set('473', '蔗糖脂肪酸酯', 'sucrose esters of fatty acids', 'caution', 'Fat source unverifiable.'); set('474', '蔗糖甘油酯', 'sucroglycerides', 'caution', 'Fat source unverifiable.');
  set('475', '聚甘油脂肪酸酯', 'polyglycerol esters of fatty acids', 'caution', 'Fat source unverifiable.'); set('476', '聚甘油蓖麻醇酯', 'PGPR (castor oil)', 'ok');
  set('477', '丙二醇脂肪酸酯', 'propylene glycol esters of fatty acids', 'caution', 'Fat source unverifiable.'); set('479b', '氧化大豆油', 'thermally oxidised soy oil', 'ok');
  set('481', '硬脂酰乳酸钠', 'sodium stearoyl lactylate', 'caution', 'Stearic acid source unverifiable.'); set('482', '硬脂酰乳酸钙', 'calcium stearoyl lactylate', 'caution', 'Stearic acid source unverifiable.');
  set('483', '硬脂酰酒石酸酯', 'stearyl tartrate', 'caution', 'Stearic acid source unverifiable.'); set('491', '山梨醇酐单硬脂酸酯', 'sorbitan monostearate', 'caution', 'Fat source unverifiable.');
  set('492', '山梨醇酐三硬脂酸酯', 'sorbitan tristearate', 'caution', 'Fat source unverifiable.'); set('493', '山梨醇酐单月桂酸酯', 'sorbitan monolaurate', 'caution', 'Fat source unverifiable.');
  set('494', '山梨醇酐单油酸酯', 'sorbitan monooleate', 'caution', 'Fat source unverifiable.'); set('495', '山梨醇酐单棕榈酸酯', 'sorbitan monopalmitate', 'caution', 'Fat source unverifiable.');
  set('432', '聚山梨酯20', 'polysorbate 20', 'caution', 'Fat source unverifiable.'); set('433', '聚山梨酯80', 'polysorbate 80', 'caution', 'Fat source unverifiable.');
  set('434', '聚山梨酯40', 'polysorbate 40', 'caution', 'Fat source unverifiable.'); set('435', '聚山梨酯60', 'polysorbate 60', 'caution', 'Fat source unverifiable.'); set('436', '聚山梨酯65', 'polysorbate 65', 'caution', 'Fat source unverifiable.');
  // minerals, anti-caking
  set('500', '碳酸钠', 'sodium carbonates', 'ok'); set('501', '碳酸钾', 'potassium carbonates', 'ok'); set('503', '碳酸铵', 'ammonium carbonates', 'ok'); set('504', '碳酸镁', 'magnesium carbonates', 'ok');
  set('507', '盐酸', 'hydrochloric acid', 'ok'); set('508', '氯化钾', 'potassium chloride', 'ok'); set('509', '氯化钙', 'calcium chloride', 'ok'); set('511', '氯化镁', 'magnesium chloride', 'ok');
  set('513', '硫酸', 'sulfuric acid', 'ok'); set('514', '硫酸钠', 'sodium sulfate', 'ok'); set('516', '硫酸钙', 'calcium sulfate', 'ok'); set('518', '硫酸镁', 'magnesium sulfate', 'ok');
  set('524', '氢氧化钠', 'sodium hydroxide', 'ok'); set('526', '氢氧化钙', 'calcium hydroxide', 'ok'); set('529', '氧化钙', 'calcium oxide', 'ok'); set('535', '亚铁氰化钠', 'sodium ferrocyanide', 'ok');
  set('536', '亚铁氰化钾', 'potassium ferrocyanide', 'ok'); set('541', '酸性磷酸铝钠', 'sodium aluminium phosphate', 'ok');
  set('542', '骨磷酸盐', 'bone phosphate', 'likely', 'Made from animal bones of unstated origin.');
  set('551', '二氧化硅', 'silicon dioxide', 'ok'); set('552', '硅酸钙', 'calcium silicate', 'ok'); set('553', '硅酸镁/滑石粉', 'magnesium silicate / talc', 'ok'); set('554', '硅铝酸钠', 'sodium aluminosilicate', 'ok');
  set('570', '脂肪酸', 'fatty acids (incl. stearic acid)', 'caution', 'May be animal- or plant-derived.'); set('572', '硬脂酸镁', 'magnesium stearate', 'caution', 'Stearic acid source unverifiable.');
  set('574', '葡萄糖酸', 'gluconic acid', 'ok'); set('575', '葡萄糖酸内酯', 'glucono delta-lactone', 'ok'); set('576', '葡萄糖酸钠', 'sodium gluconate', 'ok'); set('577', '葡萄糖酸钾', 'potassium gluconate', 'ok');
  set('578', '葡萄糖酸钙', 'calcium gluconate', 'ok'); set('579', '葡萄糖酸亚铁', 'ferrous gluconate', 'ok'); set('585', '乳酸亚铁', 'ferrous lactate', 'ok');
  // flavour enhancers
  set('620', '谷氨酸', 'glutamic acid', 'ok'); set('621', '谷氨酸钠', 'MSG', 'ok'); set('622', '谷氨酸钾', 'monopotassium glutamate', 'ok'); set('623', '谷氨酸钙', 'calcium diglutamate', 'ok');
  set('626', '鸟苷酸', 'guanylic acid', 'caution', 'From yeast, or from fish/meat.'); set('627', '5′-鸟苷酸二钠', 'disodium guanylate', 'caution', 'Usually yeast-derived; fish/meat source possible.');
  set('630', '肌苷酸', 'inosinic acid', 'caution', 'From fish/meat or fermentation.'); set('631', '5′-肌苷酸二钠', 'disodium inosinate', 'caution', 'Often from fish or meat; fermentation also used.');
  set('635', '5′-呈味核苷酸二钠', 'disodium 5-ribonucleotides', 'caution', 'Mixture of E627 and E631.');
  set('636', '麦芽酚', 'maltol', 'ok'); set('637', '乙基麦芽酚', 'ethyl maltol', 'ok');
  set('640', '甘氨酸', 'glycine', 'caution', 'Synthetic or gelatin-derived.'); set('641', 'L-亮氨酸', 'L-leucine', 'ok');
  // glazing agents, misc
  set('900', '聚二甲基硅氧烷', 'dimethylpolysiloxane', 'ok'); set('901', '蜂蜡', 'beeswax', 'ok'); set('902', '小烛树蜡', 'candelilla wax', 'ok'); set('903', '巴西棕榈蜡', 'carnauba wax', 'ok');
  set('904', '紫胶/虫胶', 'shellac (insect secretion)', 'caution', 'Most scholars allow it as a coating.'); set('905', '石蜡', 'paraffin / mineral oil', 'ok');
  set('912', '褐煤蜡酯', 'montan acid esters', 'ok'); set('913', '羊毛脂', 'lanolin', 'caution', 'From sheep wool; generally accepted.'); set('914', '氧化聚乙烯蜡', 'oxidised polyethylene wax', 'ok');
  set('920', 'L-半胱氨酸', 'L-cysteine', 'doubtful', 'Historically from hair or feathers; now mostly fermentation — unverifiable from the label.');
  set('921', 'L-胱氨酸', 'L-cystine', 'doubtful', 'As E920.'); set('927a', '偶氮甲酰胺', 'azodicarbonamide', 'ok'); set('928', '过氧化苯甲酰', 'benzoyl peroxide', 'ok');
  set('938', '氩气', 'argon', 'ok'); set('939', '氦气', 'helium', 'ok'); set('941', '氮气', 'nitrogen', 'ok'); set('942', '一氧化二氮', 'nitrous oxide', 'ok'); set('948', '氧气', 'oxygen', 'ok');
  set('949', '氢气', 'hydrogen', 'ok'); set('950', '安赛蜜', 'acesulfame K', 'ok'); set('951', '阿斯巴甜', 'aspartame', 'ok'); set('952', '甜蜜素', 'cyclamate', 'ok'); set('953', '异麦芽酮糖醇', 'isomalt', 'ok');
  set('954', '糖精', 'saccharin', 'ok'); set('955', '三氯蔗糖', 'sucralose', 'ok'); set('957', '索马甜', 'thaumatin', 'ok'); set('960', '甜菊糖苷', 'steviol glycosides', 'ok'); set('961', '纽甜', 'neotame', 'ok');
  set('962', '阿斯巴甜-安赛蜜', 'aspartame-acesulfame salt', 'ok'); set('965', '麦芽糖醇', 'maltitol', 'ok'); set('966', '乳糖醇', 'lactitol', 'ok'); set('967', '木糖醇', 'xylitol', 'ok'); set('968', '赤藓糖醇', 'erythritol', 'ok');
  set('969', '爱德万甜', 'advantame', 'ok'); set('999', '皂树皮提取物', 'quillaia extract', 'ok');
  set('1100', '淀粉酶', 'amylase', 'ok', 'Microbial or malt-derived in food use.'); set('1101', '蛋白酶', 'proteases', 'caution', 'Papain and bromelain are plant; others may be animal.');
  set('1102', '葡萄糖氧化酶', 'glucose oxidase', 'ok'); set('1103', '转化酶', 'invertase', 'ok'); set('1104', '脂肪酶', 'lipase', 'caution', 'May be animal pancreatic or microbial.');
  set('1105', '溶菌酶', 'lysozyme (egg)', 'ok'); set('1200', '聚葡萄糖', 'polydextrose', 'ok'); set('1201', '聚乙烯吡咯烷酮', 'PVP', 'ok'); set('1202', '聚乙烯聚吡咯烷酮', 'PVPP', 'ok');
  set('1204', '普鲁兰多糖', 'pullulan', 'ok'); set('1400', '糊精', 'dextrin', 'ok'); set('1401', '酸处理淀粉', 'acid-treated starch', 'ok'); set('1402', '碱处理淀粉', 'alkaline-treated starch', 'ok');
  set('1403', '漂白淀粉', 'bleached starch', 'ok'); set('1404', '氧化淀粉', 'oxidised starch', 'ok'); set('1405', '酶处理淀粉', 'enzyme-treated starch', 'ok'); set('1410', '磷酸酯淀粉', 'monostarch phosphate', 'ok');
  set('1412', '磷酸化二淀粉磷酸酯', 'distarch phosphate', 'ok'); set('1413', '磷酸化二淀粉磷酸酯', 'phosphated distarch phosphate', 'ok'); set('1414', '乙酰化二淀粉磷酸酯', 'acetylated distarch phosphate', 'ok');
  set('1420', '醋酸酯淀粉', 'starch acetate', 'ok'); set('1422', '乙酰化双淀粉己二酸酯', 'acetylated distarch adipate', 'ok'); set('1440', '羟丙基淀粉', 'hydroxypropyl starch', 'ok');
  set('1442', '羟丙基二淀粉磷酸酯', 'hydroxypropyl distarch phosphate', 'ok'); set('1450', '辛烯基琥珀酸淀粉钠', 'starch sodium octenyl succinate', 'ok'); set('1451', '乙酰化氧化淀粉', 'acetylated oxidised starch', 'ok');
  set('1505', '柠檬酸三乙酯', 'triethyl citrate', 'ok'); set('1518', '三乙酸甘油酯', 'triacetin', 'caution', 'Glycerol source unverifiable.'); set('1520', '丙二醇', 'propylene glycol', 'ok'); set('1521', '聚乙二醇', 'polyethylene glycol', 'ok');

  DB.phrases.push(
    ['我是穆斯林，不吃猪肉，不喝酒。', 'Wǒ shì mùsīlín, bù chī zhūròu, bù hē jiǔ.', 'I am Muslim. I do not eat pork or drink alcohol.'],
    ['这个有猪肉吗？', 'Zhège yǒu zhūròu ma?', 'Does this contain pork?'],
    ['这个有猪油吗？', 'Zhège yǒu zhūyóu ma?', 'Does this contain lard?'],
    ['这个含酒精吗？', 'Zhège hán jiǔjīng ma?', 'Does this contain alcohol?'],
    ['这是清真的吗？', 'Zhè shì qīngzhēn de ma?', 'Is this halal?'],
    ['这是什么肉？牛肉还是猪肉？', 'Zhè shì shénme ròu? Niúròu háishì zhūròu?', 'What meat is this? Beef or pork?'],
    ['请不要放猪肉和猪油。', 'Qǐng bùyào fàng zhūròu hé zhūyóu.', 'Please do not add pork or lard.'],
    ['不要料酒，不要酒，谢谢。', 'Bùyào liàojiǔ, bùyào jiǔ, xièxie.', 'No cooking wine, no alcohol, thank you.'],
    ['我不吃肉，有素食吗？', 'Wǒ bù chī ròu, yǒu sùshí ma?', 'I do not eat meat. Do you have vegetarian food?'],
    ['有鱼或者鸡蛋的菜吗？', 'Yǒu yú huòzhě jīdàn de cài ma?', 'Do you have fish or egg dishes?'],
    ['附近有清真餐厅吗？', 'Fùjìn yǒu qīngzhēn cāntīng ma?', 'Is there a halal restaurant nearby?'],
    ['配料表在哪里？', 'Pèiliàobiǎo zài nǎlǐ?', 'Where is the ingredient list?'],
    ['这个汤是用什么骨头熬的？', 'Zhège tāng shì yòng shénme gǔtou áo de?', 'What bones is this soup made from?'],
    ['这个有明胶吗？', 'Zhège yǒu míngjiāo ma?', 'Does this contain gelatin?'],
    ['只要蔬菜和米饭，谢谢。', 'Zhǐ yào shūcài hé mǐfàn, xièxie.', 'Just vegetables and rice, thank you.']
  );
})(HALAL_DB);
